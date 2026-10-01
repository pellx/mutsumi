/**
 * M02d - Alibaba qwen3-asr-flash-filetrans asynchronous analysis adapter.
 *
 * Contract sources: docs/aliyun-asr-integration.md ("Transcription adapter") and
 * docs/tasks/M02-filetrans-analysis.md. This module owns the whole asynchronous
 * transcription exchange for one already-published clip: it validates the asset
 * and the server-internal remote reference, submits exactly one billed task,
 * polls that task under a single shared deadline, downloads the signed result
 * and hands the bounded JSON to the mapper. It never uploads local files, loads
 * credentials or environment variables, infers emotion, or forwards the API
 * bearer to the result host.
 *
 * Boundaries implemented here:
 * - One combined `AbortSignal` (caller cancellation plus this adapter's own
 *   deadline) races every fetch, body read and polling sleep, so an injected
 *   dependency that ignores its signal still cannot leave `analyze` pending.
 *   Body release is best-effort and never awaited, so cleanup cannot extend or
 *   block the deadline.
 * - Submission happens once: an ambiguous timeout or a 429 never triggers a
 *   second billed task. The poll GET count is capped even when an injected sleep
 *   resolves immediately and would otherwise starve the deadline timer.
 * - Provider-specific field names stay inside this adapter; the mapper owns the
 *   result shape and no vendor SDK type crosses the port boundary. Missing or
 *   malformed timing stays the mapper's decision, including `timing_unavailable`.
 * - Failures are plain `AnalysisFailure` records (stage `transcription`) with
 *   static safe messages, `retryable: false` and no cause, body, URL or key.
 */

import type {
  AnalysisFailure,
  AudioAnalysisPort,
  RemoteAudioReference,
} from '../../application/analysis-ports.js';
import { validateAudioAsset } from '../../domain/annotation.ts';
import type { AnnotatedAudio, AudioAsset } from '../../domain/annotation.ts';
import { FILETRANS_MODEL, mapFiletransResult } from './filetrans-result.ts';

/** Fixed approved DashScope asynchronous submission endpoint (Beijing). */
const SUBMIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';

/** Fixed approved DashScope task-polling endpoint (Beijing). */
const TASKS_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks/';

/** Exact approved result host; official examples use http and are upgraded to https. */
const RESULT_HOST = 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com';

/** Prefix of a model-bound `oss://` object reference. */
const OSS_RESOURCE_PREFIX = 'oss://';

/** Public bucket host shape `bucket.oss-REGION.aliyuncs.com` for an https reference. */
const PUBLIC_OSS_HOST = /^[a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/;

/** Maximum accepted size of a submission or task-status JSON document (64 KiB). */
const MAX_STATUS_JSON_BYTES = 64 * 1024;

/** Largest accepted timeout or interval: the native timer range cannot overflow. */
const MAX_TIMER_MS = 2147483647;

/** Hard cap on polling GET requests for one operation. */
const MAX_POLLS_LIMIT = 10000;

/** Hard cap on the downloaded result size (16 MiB). */
const MAX_RESULT_BYTES_LIMIT = 16 * 1024 * 1024;

/** DashScope task identifiers accepted for polling. */
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** ASCII control characters (including CR/LF) are rejected in credentials and URI keys. */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

const ABORT_CONTROLLER_CLASS = globalThis.AbortController;

const CONFIG_MESSAGE = 'invalid filetrans analysis configuration';
const INVALID_AUDIO_MESSAGE = 'audio asset or remote reference is not a valid analysis input';
const MODEL_MISMATCH_MESSAGE = 'remote reference model is not supported by this analysis adapter';
const CANCELLED_MESSAGE = 'audio analysis was cancelled by the caller';
const TIMED_OUT_MESSAGE = 'audio analysis exceeded its time budget';
const SUBMISSION_FAILED_MESSAGE = 'audio analysis submission failed';
const PROVIDER_FAILED_MESSAGE = 'audio analysis provider did not produce a result';
const INVALID_RESULT_MESSAGE = 'audio analysis result is not a valid transcription payload';
const UNEXPECTED_MESSAGE = 'audio analysis failed before producing a result';

type PlainRecord = Record<string, unknown>;
type FetchLike = typeof globalThis.fetch;
type FetchInit = Parameters<FetchLike>[1];

export type FiletransAnalysisOptions = {
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly maxPolls: number;
  readonly maxResultBytes: number;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** Shared operation signal plus the flag that distinguishes `timed_out` from `cancelled`. */
type Deadline = {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
};

/** A submission either needs polling or already carries a (possibly absent) result location. */
type Submission =
  | { readonly kind: 'poll'; readonly taskId: string }
  | { readonly kind: 'result'; readonly taskId: string; readonly resultUrl: string | null };

function failure(code: AnalysisFailure['code'], message: string): AnalysisFailure {
  return { code, stage: 'transcription', message, retryable: false };
}

function invalidAudio(): AnalysisFailure {
  return failure('invalid_audio', INVALID_AUDIO_MESSAGE);
}

function modelMismatch(): AnalysisFailure {
  return failure('model_mismatch', MODEL_MISMATCH_MESSAGE);
}

function cancelled(): AnalysisFailure {
  return failure('cancelled', CANCELLED_MESSAGE);
}

function timedOut(): AnalysisFailure {
  return failure('timed_out', TIMED_OUT_MESSAGE);
}

function submissionFailed(): AnalysisFailure {
  return failure('submission_failed', SUBMISSION_FAILED_MESSAGE);
}

function providerFailed(): AnalysisFailure {
  return failure('provider_failed', PROVIDER_FAILED_MESSAGE);
}

function invalidResult(): AnalysisFailure {
  return failure('invalid_result', INVALID_RESULT_MESSAGE);
}

const FAILURE_CODES: readonly string[] = [
  'invalid_audio',
  'publication_failed',
  'model_mismatch',
  'submission_failed',
  'provider_failed',
  'timed_out',
  'cancelled',
  'invalid_result',
  'timing_unavailable',
];

/** Recognize a failure this adapter (or the mapper) already produced, so it is never wrapped. */
function isAnalysisFailure(value: unknown): value is AnalysisFailure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const record = value as PlainRecord;
  const code = record['code'];
  return (
    record['stage'] === 'transcription' &&
    record['retryable'] === false &&
    typeof record['message'] === 'string' &&
    typeof code === 'string' &&
    FAILURE_CODES.includes(code)
  );
}

/**
 * Convert any thrown value into a safe failure. An existing safe failure keeps its
 * own code; any external exception becomes the stage's static fallback, never a
 * re-classification based on a foreign `Error.name`.
 */
function asFailure(error: unknown, fallback: AnalysisFailure): AnalysisFailure {
  return isAnalysisFailure(error) ? error : fallback;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readField(record: PlainRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function readRecordField(record: PlainRecord, key: string): PlainRecord | null {
  const value = readField(record, key);
  return isPlainRecord(value) ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseJsonRecord(text: string): PlainRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isPlainRecord(parsed) ? parsed : null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasControlChar(value: string): boolean {
  return CONTROL_CHAR_PATTERN.test(value);
}

/** A valid DashScope task identifier, or `null` when the field is missing or malformed. */
function readTaskId(output: PlainRecord): string | null {
  const value = readField(output, 'task_id');
  return typeof value === 'string' && TASK_ID_PATTERN.test(value) ? value : null;
}

/** The signed result location, if the payload carries a nonempty string. */
function readTranscriptionUrl(output: PlainRecord): string | null {
  const result = readRecordField(output, 'result');
  if (result === null) return null;
  return readNonEmptyString(readField(result, 'transcription_url'));
}

/** Build the combined caller/deadline signal without an `AbortSignal.any` dependency. */
function createDeadline(caller: AbortSignal, timeoutMs: number): Deadline {
  const controller = new ABORT_CONTROLLER_CLASS();
  let expired = false;
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onCallerAbort = (): void => {
    abort();
  };
  if (caller.aborted) {
    abort();
  } else {
    caller.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = setTimeout((): void => {
    expired = true;
    abort();
  }, timeoutMs);
  const dispose = (): void => {
    clearTimeout(timer);
    caller.removeEventListener('abort', onCallerAbort);
  };
  return { signal: controller.signal, timedOut: () => expired, dispose };
}

function abortFailure(deadline: Deadline): AnalysisFailure {
  return deadline.timedOut() ? timedOut() : cancelled();
}

function throwIfAborted(deadline: Deadline): void {
  if (deadline.signal.aborted) throw abortFailure(deadline);
}

/**
 * Race an operation against the combined signal so a dependency that ignores its
 * signal cannot leave `analyze` pending. The abort listener is removed on every
 * settlement path and the losing promise always keeps an attached rejection
 * handler so it cannot surface as an unhandled rejection.
 */
function raceAbort<T>(operation: Promise<T>, deadline: Deadline): Promise<T> {
  const signal = deadline.signal;
  if (signal.aborted) {
    operation.then(undefined, () => undefined);
    throw abortFailure(deadline);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortFailure(deadline));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortFailure(deadline));
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortFailure(deadline));
          return;
        }
        reject(error);
      },
    );
  });
}

/** Native abort-aware timer used when no `sleep` is injected. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout((): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Best-effort, nonblocking release of an unread response body; never awaited. */
function releaseBody(response: Response): void {
  const body = response.body;
  if (body === null) return;
  try {
    body.cancel().then(undefined, () => undefined);
  } catch {
    /* body already locked or consumed; nothing further to release */
  }
}

/** Best-effort, nonblocking abort of a partially read stream. */
function releaseReader(reader: { cancel: () => Promise<void> }): void {
  try {
    reader.cancel().then(undefined, () => undefined);
  } catch {
    /* stream already closed or locked */
  }
}

/** Read at most `maxBytes` of a response body and decode it as UTF-8 text. */
async function readBoundedJson(
  response: Response,
  maxBytes: number,
  deadline: Deadline,
  onLimit: () => AnalysisFailure,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) {
      releaseBody(response);
      throw onLimit();
    }
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed > maxBytes) {
      releaseBody(response);
      throw onLimit();
    }
  }
  const body = response.body;
  if (body === null || typeof body.getReader !== 'function') {
    releaseBody(response);
    throw onLimit();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await raceAbort(reader.read(), deadline);
      if (step.done === true) break;
      const chunk = step.value;
      if (!(chunk instanceof Uint8Array)) throw onLimit();
      total += chunk.byteLength;
      if (total > maxBytes) throw onLimit();
      chunks.push(chunk);
    }
  } catch (error: unknown) {
    releaseReader(reader);
    throw error;
  }
  throwIfAborted(deadline);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** A `oss://` reference: nonempty slash-separated key, no dot/empty segment, control, query, hash or userinfo. */
function validateOssResourceUri(uri: string): void {
  if (!uri.startsWith(OSS_RESOURCE_PREFIX)) throw invalidAudio();
  const key = uri.slice(OSS_RESOURCE_PREFIX.length);
  if (key.length === 0 || hasControlChar(key) || key.includes('\\')) throw invalidAudio();
  if (key.includes('?') || key.includes('#') || key.includes('@')) throw invalidAudio();
  if (key.startsWith('/') || key.endsWith('/')) throw invalidAudio();
  for (const segment of key.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') throw invalidAudio();
  }
}

/** An https reference: public Alibaba OSS host, no internal endpoint, userinfo or alternate port. */
function validateHttpsReferenceUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw invalidAudio();
  }
  if (parsed.protocol !== 'https:') throw invalidAudio();
  if (parsed.username.length > 0 || parsed.password.length > 0) throw invalidAudio();
  if (parsed.port.length > 0) throw invalidAudio();
  if (parsed.hash.length > 0) throw invalidAudio();
  const hostname = parsed.hostname.toLowerCase();
  if (hostname.includes('-internal')) throw invalidAudio();
  if (!PUBLIC_OSS_HOST.test(hostname)) throw invalidAudio();
}

/**
 * Accept only the approved result host, preserving the signed query. The official
 * examples use http for this host; only that exact host is upgraded to https, and
 * its path and query are left untouched. Any other scheme or host is rejected
 * before the result is fetched.
 */
function validateResultUrl(value: string | null): string {
  if (value === null) throw invalidResult();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidResult();
  }
  const scheme = parsed.protocol;
  if (scheme !== 'http:' && scheme !== 'https:') throw invalidResult();
  if (parsed.username.length > 0 || parsed.password.length > 0) throw invalidResult();
  if (parsed.port.length > 0) throw invalidResult();
  if (parsed.hash.length > 0) throw invalidResult();
  if (parsed.hostname.toLowerCase() !== RESULT_HOST) throw invalidResult();
  if (scheme === 'http:') return `https://${RESULT_HOST}${parsed.pathname}${parsed.search}`;
  return value;
}

export class AlibabaFiletransAnalysis implements AudioAnalysisPort {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #maxPolls: number;
  readonly #maxResultBytes: number;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(options: FiletransAnalysisOptions) {
    if (!isPlainRecord(options)) throw new Error(CONFIG_MESSAGE);
    const apiKey = readField(options, 'apiKey');
    if (typeof apiKey !== 'string' || apiKey.length === 0 || hasControlChar(apiKey)) {
      throw new Error(CONFIG_MESSAGE);
    }
    const timeoutMs = readField(options, 'timeoutMs');
    if (!isPositiveSafeInteger(timeoutMs) || timeoutMs > MAX_TIMER_MS) throw new Error(CONFIG_MESSAGE);
    const pollIntervalMs = readField(options, 'pollIntervalMs');
    if (!isPositiveSafeInteger(pollIntervalMs) || pollIntervalMs > MAX_TIMER_MS) {
      throw new Error(CONFIG_MESSAGE);
    }
    const maxPolls = readField(options, 'maxPolls');
    if (!isPositiveSafeInteger(maxPolls) || maxPolls > MAX_POLLS_LIMIT) throw new Error(CONFIG_MESSAGE);
    const maxResultBytes = readField(options, 'maxResultBytes');
    if (!isPositiveSafeInteger(maxResultBytes) || maxResultBytes > MAX_RESULT_BYTES_LIMIT) {
      throw new Error(CONFIG_MESSAGE);
    }
    const fetchOption = readField(options, 'fetch');
    if (fetchOption !== undefined && typeof fetchOption !== 'function') throw new Error(CONFIG_MESSAGE);
    const nowOption = readField(options, 'now');
    if (nowOption !== undefined && typeof nowOption !== 'function') throw new Error(CONFIG_MESSAGE);
    const sleepOption = readField(options, 'sleep');
    if (sleepOption !== undefined && typeof sleepOption !== 'function') throw new Error(CONFIG_MESSAGE);
    this.#apiKey = apiKey;
    this.#timeoutMs = timeoutMs;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxPolls = maxPolls;
    this.#maxResultBytes = maxResultBytes;
    this.#fetch = typeof fetchOption === 'function' ? (fetchOption as FetchLike) : globalThis.fetch;
    this.#now = typeof nowOption === 'function' ? (nowOption as () => number) : Date.now;
    this.#sleep =
      typeof sleepOption === 'function'
        ? (sleepOption as (ms: number, signal: AbortSignal) => Promise<void>)
        : defaultSleep;
  }

  async analyze(
    audio: AudioAsset,
    remote: RemoteAudioReference,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio> {
    const deadline = createDeadline(options.signal, this.#timeoutMs);
    try {
      const audioAsset = this.#validateAsset(audio);
      const reference = this.#validateReference(remote);
      throwIfAborted(deadline);
      const submission = await this.#submit(reference, deadline);
      throwIfAborted(deadline);
      const resultUrl =
        submission.kind === 'result'
          ? submission.resultUrl
          : await this.#poll(submission.taskId, deadline);
      throwIfAborted(deadline);
      return await this.#download(resultUrl, audioAsset, deadline);
    } catch (error: unknown) {
      throw asFailure(error, failure('provider_failed', UNEXPECTED_MESSAGE));
    } finally {
      deadline.dispose();
    }
  }

  /** Reject a malformed asset before any other work. */
  #validateAsset(audio: AudioAsset): AudioAsset {
    const validated = validateAudioAsset(audio);
    if (!validated.ok) throw invalidAudio();
    return validated.value;
  }

  /** Reject a model mismatch, an unsafe reference and an expired reference before any request. */
  #validateReference(remote: RemoteAudioReference): RemoteAudioReference {
    if (!isPlainRecord(remote)) throw invalidAudio();
    if (readField(remote, 'model') !== FILETRANS_MODEL) throw modelMismatch();
    const transport = readField(remote, 'transport');
    const uri = readField(remote, 'uri');
    if (typeof uri !== 'string' || uri.length === 0) throw invalidAudio();
    if (transport === 'oss-resource') validateOssResourceUri(uri);
    else if (transport === 'https') validateHttpsReferenceUri(uri);
    else throw invalidAudio();
    const expiry = readField(remote, 'expires_at_ms');
    if (expiry !== null) {
      if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry)) throw invalidAudio();
      const now = this.#readNow();
      if (now === null || expiry <= now) throw invalidAudio();
    }
    return remote;
  }

  /** Read the injected clock as a non-negative safe integer, or `null` when unusable. */
  #readNow(): number | null {
    let value: unknown;
    try {
      value = this.#now();
    } catch {
      return null;
    }
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  /** Submit exactly one asynchronous task; never retry an ambiguous submission. */
  async #submit(reference: RemoteAudioReference, deadline: Deadline): Promise<Submission> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      };
      if (reference.transport === 'oss-resource') {
        headers['X-DashScope-OssResourceResolve'] = 'enable';
      }
      const body = JSON.stringify({
        model: FILETRANS_MODEL,
        input: { file_url: reference.uri },
        parameters: { channel_id: [0], enable_itn: false, enable_words: true },
      });
      const response = await this.#fetchGuarded(
        SUBMIT_URL,
        { method: 'POST', headers, body, redirect: 'error', signal: deadline.signal },
        deadline,
      );
      if (response.status !== 200) {
        releaseBody(response);
        throw submissionFailed();
      }
      let raw: string;
      try {
        raw = await readBoundedJson(response, MAX_STATUS_JSON_BYTES, deadline, submissionFailed);
      } catch (error: unknown) {
        releaseBody(response);
        throw error;
      }
      const root = parseJsonRecord(raw);
      if (root === null) throw submissionFailed();
      const output = readRecordField(root, 'output');
      if (output === null) throw submissionFailed();
      const taskId = readTaskId(output);
      if (taskId === null) throw submissionFailed();
      const status = readField(output, 'task_status');
      if (status === 'PENDING' || status === 'RUNNING') return { kind: 'poll', taskId };
      if (status === 'SUCCEEDED') {
        return { kind: 'result', taskId, resultUrl: readTranscriptionUrl(output) };
      }
      if (status === 'FAILED' || status === 'UNKNOWN') throw providerFailed();
      throw submissionFailed();
    } catch (error: unknown) {
      throw asFailure(error, submissionFailed());
    }
  }

  /** Poll the task under the shared deadline until it succeeds or the budget is spent. */
  async #poll(taskId: string, deadline: Deadline): Promise<string | null> {
    try {
      const url = `${TASKS_URL}${encodeURIComponent(taskId)}`;
      for (let attempt = 0; attempt < this.#maxPolls; attempt += 1) {
        await this.#wait(deadline);
        const response = await this.#fetchGuarded(
          url,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.#apiKey}` },
            redirect: 'error',
            signal: deadline.signal,
          },
          deadline,
        );
        if (response.status !== 200) {
          releaseBody(response);
          throw providerFailed();
        }
        let raw: string;
        try {
          raw = await readBoundedJson(response, MAX_STATUS_JSON_BYTES, deadline, invalidResult);
        } catch (error: unknown) {
          releaseBody(response);
          throw error;
        }
        const root = parseJsonRecord(raw);
        if (root === null) throw invalidResult();
        const output = readRecordField(root, 'output');
        if (output === null) throw invalidResult();
        if (readField(output, 'task_id') !== taskId) throw invalidResult();
        const status = readField(output, 'task_status');
        if (status === 'PENDING' || status === 'RUNNING') continue;
        if (status === 'SUCCEEDED') return readTranscriptionUrl(output);
        if (status === 'FAILED' || status === 'UNKNOWN') throw providerFailed();
        throw invalidResult();
      }
      throwIfAborted(deadline);
      throw timedOut();
    } catch (error: unknown) {
      throw asFailure(error, providerFailed());
    }
  }

  /** Wait one configured interval under the deadline before every poll GET. */
  async #wait(deadline: Deadline): Promise<void> {
    await raceAbort(this.#sleep(this.#pollIntervalMs, deadline.signal), deadline);
    throwIfAborted(deadline);
  }

  /** Validate the result location, download it without credentials, then map the payload. */
  async #download(
    rawUrl: string | null,
    audio: AudioAsset,
    deadline: Deadline,
  ): Promise<AnnotatedAudio> {
    try {
      const url = validateResultUrl(rawUrl);
      const response = await this.#fetchGuarded(
        url,
        { method: 'GET', redirect: 'error', signal: deadline.signal },
        deadline,
      );
      if (response.status !== 200) {
        releaseBody(response);
        throw invalidResult();
      }
      let raw: string;
      try {
        raw = await readBoundedJson(response, this.#maxResultBytes, deadline, invalidResult);
      } catch (error: unknown) {
        releaseBody(response);
        throw error;
      }
      throwIfAborted(deadline);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw invalidResult();
      }
      const mapped = mapFiletransResult(parsed, audio);
      if (!mapped.ok) throw mapped.error;
      throwIfAborted(deadline);
      return mapped.value;
    } catch (error: unknown) {
      throw asFailure(error, invalidResult());
    }
  }

  /**
   * Fetch while racing the combined signal. A response that arrives only after the
   * deadline fired has no caller left to consume it, so its body is released
   * best-effort instead of being left half-read.
   */
  async #fetchGuarded(url: string, init: FetchInit, deadline: Deadline): Promise<Response> {
    const pending = this.#fetch(url, init);
    pending.then(
      (response) => {
        if (deadline.signal.aborted) releaseBody(response);
      },
      () => undefined,
    );
    return raceAbort(pending, deadline);
  }
}
