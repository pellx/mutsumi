/**
 * M02c - Alibaba model-bound temporary audio publication adapter.
 *
 * Contract sources: docs/aliyun-asr-integration.md ("Publication adapter") and
 * docs/tasks/M02-temporary-publication.md. This module only publishes an
 * already-stored local clip to Alibaba's temporary OSS upload endpoint and
 * returns a model-bound `oss://` reference. It does not submit, poll or map an
 * ASR job, load environment variables, resolve filesystem paths, or log
 * provider payloads. Provider-specific field names stay inside this adapter and
 * no vendor SDK type crosses the port boundary.
 *
 * Boundaries implemented here:
 * - The caller supplies an opaque `storage_key`; the injected `readAudio`
 *   resolves it server-side. No client path is ever accepted.
 * - The policy bearer credential is stored in a `#` field and is only ever sent
 *   to the DashScope upload-policy endpoint, never to OSS.
 * - A single combined `AbortSignal` (caller cancellation plus this adapter's
 *   own deadline) races the local reader, both HTTP requests and every body
 *   read, so an injected dependency that ignores its signal cannot leave
 *   `publish` pending. Body release is best-effort and never awaited, so
 *   cancellation cleanup cannot extend or block the publication deadline.
 * - The policy response arrival time is captured before its body is read, its
 *   short upload-credential TTL is re-checked immediately before the POST, and
 *   the returned expiry is a separate conservative prototype media-lifetime
 *   estimate (48h).
 * - Returned failure objects match `AnalysisFailure` (stage `publication`),
 *   carry static safe messages, never a cause, body, URL or key value, and are
 *   always `retryable: false`; the caller controls explicit retries.
 */

import type { AudioPublicationPort, RemoteAudioReference, StoredAudio } from '../../application/analysis-ports.js';
import { validateAudioAsset } from '../../domain/annotation.ts';
import { FILETRANS_MODEL } from './filetrans-result.ts';

/** Fixed approved DashScope upload-policy endpoint (Beijing). */
const UPLOAD_POLICY_URL = 'https://dashscope.aliyuncs.com/api/v1/uploads';

/** Maximum accepted size of the policy JSON document (64 KiB). */
const MAX_POLICY_BYTES = 64 * 1024;

/** Conservative prototype media lifetime used for the returned expiry estimate. */
const MEDIA_LIFETIME_MS = 48 * 60 * 60 * 1000;

/** Largest accepted timeout: the native timer range cannot overflow or wrap. */
const MAX_TIMER_MS = 2147483647;

/** Exact OSS host suffix allowed for the upload target. */
const OSS_HOST_SUFFIX = '.oss-cn-beijing.aliyuncs.com';

/** Opaque server-internal storage key: never a path, drive letter or slash. */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Generated object identifier used as the upload filename stem. */
const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** ASCII control characters (including CR/LF) are rejected in opaque identifiers. */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/** Media type to OSS object extension for the model-supported intake formats. */
const MEDIA_EXTENSION: ReadonlyMap<string, string> = new Map<string, string>([
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/flac', 'flac'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/webm', 'webm'],
  ['audio/aac', 'aac'],
]);

const BLOB_CLASS = globalThis.Blob;
const ABORT_CONTROLLER_CLASS = globalThis.AbortController;

const CONFIG_MESSAGE = 'invalid temporary publication configuration';
const INVALID_AUDIO_MESSAGE = 'audio asset is not a valid publication input';
const INVALID_KEY_MESSAGE = 'storage key is not an accepted opaque identifier';
const MODEL_MISMATCH_MESSAGE = 'requested model is not supported by this publication adapter';
const CANCELLED_MESSAGE = 'audio publication was cancelled by the caller';
const TIMED_OUT_MESSAGE = 'audio publication exceeded its time budget';
const PUBLICATION_FAILED_MESSAGE = 'audio publication failed';

type PlainRecord = Record<string, unknown>;
type PublicationFailure = {
  readonly code:
    | 'invalid_audio'
    | 'publication_failed'
    | 'model_mismatch'
    | 'timed_out'
    | 'cancelled';
  readonly stage: 'publication';
  readonly message: string;
  readonly retryable: false;
};

export type TemporaryPublicationOptions = {
  readonly apiKey: string;
  readonly readAudio: (storageKey: string, signal: AbortSignal) => Promise<Blob>;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly objectId?: () => string;
};

type Deadline = {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
};

/** Input facts known before the asset is read (no blob yet). */
type InputCheck = {
  readonly key: string;
  readonly mediaType: string;
  readonly extension: string;
};

/** Input facts plus the real blob confirmed by the post-read checks. */
type LoadedAudio = InputCheck & {
  readonly blob: Blob;
};

type UploadPolicy = {
  readonly policy: string;
  readonly signature: string;
  readonly uploadDir: string;
  readonly uploadHost: string;
  readonly ossAccessKeyId: string;
  readonly acl: string;
  readonly forbidOverwrite: string;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly acquiredAt: number;
  readonly mediaExpiresAt: number;
};

type FetchLike = typeof globalThis.fetch;
type FetchInit = Parameters<FetchLike>[1];

/**
 * Internal marked error. `message` is static and safe; it never embeds a URL,
 * provider body, signature or credential value.
 */
class PublicationError extends Error {
  readonly code: PublicationFailure['code'];

  constructor(code: PublicationFailure['code'], message: string) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
  }
}

function isPublicationError(value: unknown): value is PublicationError {
  return value instanceof PublicationError;
}

/** A plain JSON record: `Object.prototype`/`null` prototype, own enumerable data fields. */
function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readField(record: PlainRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasControlChar(value: string): boolean {
  return CONTROL_CHAR_PATTERN.test(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || hasControlChar(value)) return null;
  return value;
}

function failure(code: PublicationFailure['code'], message: string): PublicationFailure {
  return { code, stage: 'publication', message, retryable: false };
}

function invalidAudio(): PublicationError {
  return new PublicationError('invalid_audio', INVALID_AUDIO_MESSAGE);
}

function modelMismatch(): PublicationError {
  return new PublicationError('model_mismatch', MODEL_MISMATCH_MESSAGE);
}

function cancelled(): PublicationError {
  return new PublicationError('cancelled', CANCELLED_MESSAGE);
}

function timedOut(): PublicationError {
  return new PublicationError('timed_out', TIMED_OUT_MESSAGE);
}

function publicationFailed(): PublicationError {
  return new PublicationError('publication_failed', PUBLICATION_FAILED_MESSAGE);
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
  const timer = setTimeout(() => {
    expired = true;
    abort();
  }, timeoutMs);
  const dispose = (): void => {
    clearTimeout(timer);
    caller.removeEventListener('abort', onCallerAbort);
  };
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose,
  };
}

/**
 * Throw the distinguished caller-cancellation or own-deadline failure when the
 * combined signal has fired. Which one it is comes from the deadline's own timer
 * flag, never from inspecting an arbitrary external error.
 */
function throwIfAborted(deadline: Deadline): void {
  if (!deadline.signal.aborted) return;
  throw deadline.timedOut() ? timedOut() : cancelled();
}

/**
 * Race an operation against the combined signal so a dependency that ignores its
 * signal cannot leave the caller pending. The abort listener is removed on both
 * the abort and the normal settlement paths, and the losing promise always keeps
 * an attached rejection handler so it cannot surface as an unhandled rejection.
 * External exceptions are mapped to the static publication failure; they are
 * never re-classified by inspecting a foreign `Error.name`.
 */
function raceAbort<T>(operation: Promise<T>, deadline: Deadline): Promise<T> {
  const signal = deadline.signal;
  if (signal.aborted) {
    operation.then(undefined, () => undefined);
    throw deadline.timedOut() ? timedOut() : cancelled();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(deadline.timedOut() ? timedOut() : cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(deadline.timedOut() ? timedOut() : cancelled());
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(deadline.timedOut() ? timedOut() : cancelled());
          return;
        }
        reject(isPublicationError(error) ? error : publicationFailed());
      },
    );
  });
}

/** Read a `number | decimal-numeric-string` policy field; never a general coercion. */
function readNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Validate the policy upload host: HTTPS Alibaba Beijing OSS bucket, no port/creds/path. */
function validateUploadHost(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw publicationFailed();
  }
  if (parsed.protocol !== 'https:') throw publicationFailed();
  if (parsed.username.length > 0 || parsed.password.length > 0) throw publicationFailed();
  if (parsed.port.length > 0) throw publicationFailed();
  if (parsed.search.length > 0 || parsed.hash.length > 0) throw publicationFailed();
  if (parsed.pathname !== '/') throw publicationFailed();
  const hostname = parsed.hostname;
  if (hostname.toLowerCase().endsWith(OSS_HOST_SUFFIX) === false) throw publicationFailed();
  const bucket = hostname.slice(0, hostname.length - OSS_HOST_SUFFIX.length);
  if (bucket.length === 0) throw publicationFailed();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket) === false) throw publicationFailed();
}

/**
 * Validate a safe nonempty slash-separated OSS object prefix: no leading or
 * trailing slash, no empty/`.`/`..` segment, no backslash and no control char.
 * Object keys are then built by explicit slash joining, so the prefix format is
 * never inferred from separator guessing.
 */
function validateUploadDir(value: string): void {
  if (value.length === 0) throw publicationFailed();
  if (hasControlChar(value)) throw publicationFailed();
  if (value.includes('\\')) throw publicationFailed();
  if (value.startsWith('/') || value.endsWith('/')) throw publicationFailed();
  for (const segment of value.split('/')) {
    if (segment.length === 0) throw publicationFailed();
    if (segment === '.' || segment === '..') throw publicationFailed();
  }
}

function parsePolicy(raw: string): PlainRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw publicationFailed();
  }
  if (!isPlainRecord(parsed)) throw publicationFailed();
  const data = readField(parsed, 'data');
  if (!isPlainRecord(data)) throw publicationFailed();
  return data;
}

function readPolicyNonEmpty(data: PlainRecord, key: string): string {
  const value = nonEmptyString(readField(data, key));
  if (value === null) throw publicationFailed();
  return value;
}

export class AlibabaTemporaryPublication implements AudioPublicationPort {
  readonly #apiKey: string;
  readonly #readAudio: (storageKey: string, signal: AbortSignal) => Promise<Blob>;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #objectId: () => string;

  constructor(options: TemporaryPublicationOptions) {
    if (!isPlainRecord(options)) throw new Error(CONFIG_MESSAGE);
    const apiKey = options.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0 || hasControlChar(apiKey)) {
      throw new Error(CONFIG_MESSAGE);
    }
    const readAudio = options.readAudio;
    if (typeof readAudio !== 'function') throw new Error(CONFIG_MESSAGE);
    if (!isPositiveSafeInteger(options.maxBytes)) throw new Error(CONFIG_MESSAGE);
    if (!isPositiveSafeInteger(options.timeoutMs) || options.timeoutMs > MAX_TIMER_MS) {
      throw new Error(CONFIG_MESSAGE);
    }
    if (options.fetch !== undefined && typeof options.fetch !== 'function') {
      throw new Error(CONFIG_MESSAGE);
    }
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new Error(CONFIG_MESSAGE);
    }
    if (options.objectId !== undefined && typeof options.objectId !== 'function') {
      throw new Error(CONFIG_MESSAGE);
    }
    this.#apiKey = apiKey;
    this.#readAudio = readAudio;
    this.#maxBytes = options.maxBytes;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#objectId = options.objectId ?? (() => globalThis.crypto.randomUUID());
  }

  async publish(
    audio: StoredAudio,
    options: { readonly model: string; readonly signal: AbortSignal },
  ): Promise<RemoteAudioReference> {
    const deadline = createDeadline(options.signal, this.#timeoutMs);
    try {
      const check = this.#validateInput(audio);
      if (options.model !== FILETRANS_MODEL) throw modelMismatch();
      throwIfAborted(deadline);
      const blob = await this.#loadAudio(check.key, deadline);
      const loaded = this.#verifyAudio(check, blob);
      throwIfAborted(deadline);
      const reference = await this.#runPublish(loaded, deadline);
      throwIfAborted(deadline);
      return reference;
    } catch (error: unknown) {
      throw toFailure(error);
    } finally {
      deadline.dispose();
    }
  }

  /** Reject an invalid asset, key and unsupported media type before any read or request. */
  #validateInput(audio: StoredAudio): InputCheck {
    if (!isPlainRecord(audio)) throw invalidAudio();
    const validated = validateAudioAsset(audio.asset);
    if (!validated.ok) throw invalidAudio();
    const mediaType = validated.value.media_type.toLowerCase();
    const extension = MEDIA_EXTENSION.get(mediaType);
    if (extension === undefined) throw invalidAudio();
    const key: unknown = readField(audio, 'storage_key');
    if (typeof key !== 'string' || !STORAGE_KEY_PATTERN.test(key)) {
      throw new PublicationError('invalid_audio', INVALID_KEY_MESSAGE);
    }
    return { key, mediaType, extension };
  }

  /** Read through the injected reader, racing it against the combined signal. */
  async #loadAudio(key: string, deadline: Deadline): Promise<Blob> {
    const blob = await raceAbort(this.#readAudio(key, deadline.signal), deadline);
    if (typeof BLOB_CLASS !== 'function' || (blob instanceof BLOB_CLASS) === false) {
      throw invalidAudio();
    }
    return blob;
  }

  /** Confirm the read blob is nonempty and matches the declared media type. */
  #verifyAudio(check: InputCheck, blob: Blob): LoadedAudio {
    const size = blob.size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw invalidAudio();
    if (size > this.#maxBytes) throw invalidAudio();
    const blobType = typeof blob.type === 'string' ? blob.type.toLowerCase() : '';
    if (blobType !== check.mediaType) throw invalidAudio();
    return { key: check.key, mediaType: check.mediaType, extension: check.extension, blob };
  }

  /** Retrieve the upload policy, enforce the effective size limit, upload, build the reference. */
  async #runPublish(audio: LoadedAudio, deadline: Deadline): Promise<RemoteAudioReference> {
    const policy = await this.#requestPolicy(deadline);
    throwIfAborted(deadline);
    const sizeLimit = Math.min(this.#maxBytes, policy.maxBytes);
    if (audio.blob.size > sizeLimit) throw invalidAudio();
    const objectId = this.#generateObjectId();
    const objectKey = `${policy.uploadDir}/${objectId}.${audio.extension}`;
    const uploadUrl = `${new URL(policy.uploadHost).origin}/`;
    const form = new FormData();
    form.append('OSSAccessKeyId', policy.ossAccessKeyId);
    form.append('Signature', policy.signature);
    form.append('policy', policy.policy);
    form.append('x-oss-object-acl', policy.acl);
    form.append('x-oss-forbid-overwrite', policy.forbidOverwrite);
    form.append('key', objectKey);
    form.append('success_action_status', '200');
    form.append('file', audio.blob, `${objectId}.${audio.extension}`);
    this.#assertPolicyFresh(policy);
    throwIfAborted(deadline);
    await this.#postUpload(uploadUrl, form, deadline);
    const expiresAt = policy.mediaExpiresAt;
    return {
      uri: `oss://${objectKey}`,
      model: FILETRANS_MODEL,
      expires_at_ms: expiresAt,
      transport: 'oss-resource',
    };
  }

  /** GET the upload policy with a bounded body read and abort-aware waits. */
  async #requestPolicy(deadline: Deadline): Promise<UploadPolicy> {
    const url = `${UPLOAD_POLICY_URL}?action=getPolicy&model=${encodeURIComponent(FILETRANS_MODEL)}`;
    const response = await this.#fetchGuarded(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        signal: deadline.signal,
      },
      deadline,
    );
    if (response.status !== 200) {
      releaseBody(response);
      throw publicationFailed();
    }
    // Capture the arrival time before the body is read so a slow body download
    // cannot stretch the short-lived upload-credential window.
    // Any failure here (clock, body read or payload checks) must still release
    // the policy body best-effort without awaiting a cancellation that may never
    // settle, then rethrow the original safe failure so cleanup cannot mask it.
    try {
      const acquiredAt = this.#readNow();
      const raw = await readBoundedJson(response, MAX_POLICY_BYTES, deadline);
      return buildPolicy(parsePolicy(raw), acquiredAt);
    } catch (error: unknown) {
      releaseBody(response);
      throw error;
    }
  }

  /** POST the multipart form to the policy host root without API authorization. */
  async #postUpload(url: string, form: FormData, deadline: Deadline): Promise<void> {
    const response = await this.#fetchGuarded(
      url,
      { method: 'POST', body: form, redirect: 'error', signal: deadline.signal },
      deadline,
    );
    releaseBody(response);
    if (response.status !== 200) throw publicationFailed();
    throwIfAborted(deadline);
  }

  /**
   * Fetch while racing the combined signal. A response that arrives only after
   * the deadline fired has no caller left to consume it, so its body is released
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

  #readNow(): number {
    let value: unknown;
    try {
      value = this.#now();
    } catch {
      throw publicationFailed();
    }
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw publicationFailed();
    return value as number;
  }

  #generateObjectId(): string {
    let value: unknown;
    try {
      value = this.#objectId();
    } catch {
      throw publicationFailed();
    }
    if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) throw publicationFailed();
    return value;
  }

  /** Reject a rewound clock or an expired upload credential immediately before the POST. */
  #assertPolicyFresh(policy: UploadPolicy): void {
    const now = this.#readNow();
    if (now < policy.acquiredAt) throw publicationFailed();
    if (now - policy.acquiredAt >= policy.ttlMs) throw publicationFailed();
  }
}

/** Read at most `maxBytes` from the response body and return the decoded JSON text. */
async function readBoundedJson(
  response: Response,
  maxBytes: number,
  deadline: Deadline,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) {
      releaseBody(response);
      throw publicationFailed();
    }
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed > maxBytes) {
      releaseBody(response);
      throw publicationFailed();
    }
  }
  const body = response.body;
  if (body === null || typeof body.getReader !== 'function') {
    releaseBody(response);
    throw publicationFailed();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await raceAbort(reader.read(), deadline);
      if (step.done === true) break;
      const chunk = step.value;
      if (!(chunk instanceof Uint8Array)) throw publicationFailed();
      total += chunk.byteLength;
      if (total > maxBytes) throw publicationFailed();
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

/**
 * Best-effort, nonblocking release of a response body. Cleanup is never awaited
 * so a body that never settles cannot hang or extend the publication deadline;
 * the rejection is still observed to avoid an unhandled rejection.
 */
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

/** Validate and normalize the policy payload into an internal record. */
function buildPolicy(data: PlainRecord, acquiredAt: number): UploadPolicy {
  const policy = readPolicyNonEmpty(data, 'policy');
  const signature = readPolicyNonEmpty(data, 'signature');
  const uploadDir = readPolicyNonEmpty(data, 'upload_dir');
  const uploadHost = readPolicyNonEmpty(data, 'upload_host');
  const ossAccessKeyId = readPolicyNonEmpty(data, 'oss_access_key_id');
  const acl = readField(data, 'x_oss_object_acl');
  const forbidOverwrite = readField(data, 'x_oss_forbid_overwrite');
  if (acl !== 'private') throw publicationFailed();
  if (forbidOverwrite !== 'true') throw publicationFailed();
  validateUploadHost(uploadHost);
  validateUploadDir(uploadDir);
  const ttlSeconds = readNumeric(readField(data, 'expire_in_seconds'));
  if (ttlSeconds === null || ttlSeconds <= 0 || Number.isInteger(ttlSeconds) === false) {
    throw publicationFailed();
  }
  const sizeMb = readNumeric(readField(data, 'max_file_size_mb'));
  if (sizeMb === null || sizeMb <= 0) throw publicationFailed();
  const maxBytes = Math.floor(sizeMb * 1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw publicationFailed();
  const ttlMs = ttlSeconds * 1000;
  if (!Number.isSafeInteger(ttlMs)) throw publicationFailed();
  const mediaExpiresAt = acquiredAt + MEDIA_LIFETIME_MS;
  if (!Number.isSafeInteger(mediaExpiresAt)) throw publicationFailed();
  return {
    policy,
    signature,
    uploadDir,
    uploadHost,
    ossAccessKeyId,
    acl,
    forbidOverwrite,
    maxBytes,
    ttlMs,
    acquiredAt,
    mediaExpiresAt,
  };
}

/** Convert any internal or external error into a safe `AnalysisFailure` object. */
function toFailure(error: unknown): PublicationFailure {
  if (isPublicationError(error)) return failure(error.code, error.message);
  return failure('publication_failed', PUBLICATION_FAILED_MESSAGE);
}

export type { PublicationFailure };
