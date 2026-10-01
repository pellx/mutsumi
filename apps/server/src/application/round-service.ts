/**
 * M03 - bounded complete-round orchestration service.
 *
 * One round: intake -> analysis -> context -> dialogue -> expression -> synthesis
 * -> storage. Inputs are browser bytes plus a declared media type only; provider
 * payloads, storage keys and filesystem paths stay inside their adapters. This
 * service owns no HTTP, filesystem, environment, vendor type, endpointing,
 * interruption control, WebSocket or hidden retry.
 *
 * Boundaries enforced here:
 * - A submission is validated and snapshotted synchronously before any await, so
 *   later caller mutation cannot change an in-flight round.
 * - Idempotency is a SHA-256 over the raw bytes plus the declared media type,
 *   scoped to one session + client request id: an identical resubmission returns
 *   the same job (even while busy); a reused id with different input is invalid.
 * - One active complete round per service. A distinct submission while a round is
 *   active is rejected as busy, never queued or retried.
 * - Every port await is raced against the shared round deadline so a
 *   non-cooperative provider cannot hold a job forever. A cancelled/timed-out
 *   round reduces to an owned safe failure, never a raw provider error or code.
 * - Accepted port output is cloned immediately. Public jobs and records are
 *   independent clones and never expose a private storage key.
 * - A terminal record is persisted exactly once through a separate bounded store
 *   call with no retry. Persistence stays honest: `persisted` becomes true only
 *   after confirmed success, a pending write is never shown as stored, and an
 *   ambiguous late completion is not evidence that nothing was written.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AnnotatedAudio, AudioAsset } from '../domain/annotation.ts';
import { validateAnnotatedAudio, validateAudioAsset } from '../domain/annotation.ts';
import type {
  OutputAlignment,
  ReplyDraft,
  ReplyPlan,
  RoundFailure,
  RoundStage,
  RuntimeMode,
  StageOutcome,
  TurnRecord,
} from '../domain/conversation.ts';
import {
  validateGeneratedSpeech,
  validateReplyDraft,
} from '../domain/conversation-validation.ts';
import { validateTurnRecord } from '../domain/turn-record-validation.ts';
import type { LocalAudioAnalysisPort, StoredAudio } from './analysis-ports.ts';
import type {
  AudioIntakePort,
  ConversationStorePort,
  DialoguePort,
  IntakeSubmission,
  SpeechSynthesisPort,
} from './conversation-ports.ts';
import { buildDialogueContext } from './dialogue-context.ts';
import { buildReplyPlan } from './expression-plan.ts';
import { makeRoundError, toRoundFailure } from './round-errors.ts';

const MAX_CLIP_BYTES = 10 * 1024 * 1024;
const MAX_MIME_LENGTH = 128;
const MAX_SOURCE_DURATION_MS = 30_250;
const MAX_ANALYSIS_DURATION_MS = 30_000;
const ANALYSIS_MEDIA_TYPE = 'audio/wav';
const ANALYSIS_SAMPLE_RATE_HZ = 16_000;
const ANALYSIS_CHANNELS = 1;
const MAX_JOBS = 256;
const STORE_TIMEOUT_MS = 2_000;
const DEFAULT_DEADLINE_MS = 120_000;
const MAX_DEADLINE_MS = 120_000;
const HISTORY_LIMIT = 6;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

const STAGE_ORDER: readonly RoundStage[] = [
  'intake',
  'analysis',
  'context',
  'dialogue',
  'expression',
  'synthesis',
  'storage',
  'complete',
];
const SUBMIT_KEYS: readonly string[] = ['session_id', 'client_request_id', 'submission'];
const SUBMISSION_KEYS: readonly string[] = ['bytes', 'declared_media_type'];
const INTAKE_KEYS: readonly string[] = ['original', 'analysis'];
const STORED_AUDIO_KEYS: readonly string[] = ['asset', 'storage_key'];

const SKIPPED_REASON = 'Skipped because an earlier stage did not complete.';
const STORAGE_FAILURE_REASON = 'The round record could not be stored.';
const INTERNAL_FAILURE_REASON = 'The round record could not be validated.';

/** Public, clone-safe status of one submitted round. */
export type RoundJob = {
  job_id: string;
  turn_id: string;
  session_id: string;
  client_request_id: string;
  mode: RuntimeMode;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  stage: RoundStage;
  record: TurnRecord | null;
  failure: RoundFailure | null;
  persisted: boolean;
};

/** One browser submission: a session, a canonical UUID request id and raw bytes. */
export type SubmitRequest = {
  session_id: string;
  client_request_id: string;
  submission: IntakeSubmission;
};

/** Trusted construction-time configuration: independent ports plus runtime mode. */
export type RoundServiceDeps = {
  intake: AudioIntakePort;
  analysis: LocalAudioAnalysisPort;
  dialogue: DialoguePort;
  synthesis: SpeechSynthesisPort;
  store: ConversationStorePort;
  mode: RuntimeMode;
  deadlineMs?: number;
};

type JobEntry = {
  job: RoundJob;
  fingerprint: string;
  request_key: string;
  created_at_ms: number;
};

type StageResult<T> = { ok: true; value: T } | { ok: false; failure: RoundFailure };

type Parts = {
  sourceAsset: AudioAsset;
  inputAsset: AudioAsset;
  annotation: AnnotatedAudio | null;
  draft: ReplyDraft | null;
  plan: ReplyPlan | null;
  outputAsset: AudioAsset | null;
  outputAlignment: OutputAlignment | null;
  appliedControls: string[];
  unsupportedControls: string[];
};

type ParsedSubmit = {
  sessionId: string;
  requestId: string;
  bytes: Uint8Array;
  mime: string;
};

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

function isActiveStatus(status: RoundJob['status']): boolean {
  return status === 'queued' || status === 'processing';
}

function cloneJob(job: RoundJob): RoundJob {
  return {
    job_id: job.job_id,
    turn_id: job.turn_id,
    session_id: job.session_id,
    client_request_id: job.client_request_id,
    mode: job.mode,
    status: job.status,
    stage: job.stage,
    record: job.record === null ? null : structuredClone(job.record),
    failure: job.failure === null ? null : { ...job.failure },
    persisted: job.persisted,
  };
}

/** Deep-copy stage outcomes while omitting absent reasons (undefined is not JSON data). */
function cloneStages(
  stages: Partial<Record<RoundStage, StageOutcome>>,
): Partial<Record<RoundStage, StageOutcome>> {
  const copy: Partial<Record<RoundStage, StageOutcome>> = {};
  for (const stage of Object.keys(stages) as RoundStage[]) {
    const outcome = stages[stage];
    if (outcome === undefined) continue;
    copy[stage] = outcome.reason === undefined
      ? { status: outcome.status }
      : { status: outcome.status, reason: outcome.reason };
  }
  return copy;
}

function outcomeFor(failure: RoundFailure): StageOutcome {
  return {
    status: failure.code === 'provider_unavailable' ? 'unavailable' : 'failed',
    reason: failure.message,
  };
}

function buildTurnRecord(
  job: RoundJob,
  createdAtMs: number,
  mode: RuntimeMode,
  parts: Parts,
  stages: Partial<Record<RoundStage, StageOutcome>>,
  failure: RoundFailure | null,
): TurnRecord {
  return {
    turn_id: job.turn_id,
    session_id: job.session_id,
    client_request_id: job.client_request_id,
    created_at_ms: createdAtMs,
    mode,
    source_asset: structuredClone(parts.sourceAsset),
    input_asset: structuredClone(parts.inputAsset),
    annotation: parts.annotation === null ? null : structuredClone(parts.annotation),
    reply_draft: parts.draft === null ? null : structuredClone(parts.draft),
    reply_plan: parts.plan === null ? null : structuredClone(parts.plan),
    output_asset: parts.outputAsset === null ? null : structuredClone(parts.outputAsset),
    output_alignment: parts.outputAlignment === null ? null : structuredClone(parts.outputAlignment),
    applied_controls: parts.appliedControls.slice(),
    unsupported_controls: parts.unsupportedControls.slice(),
    playback_completed: false,
    stages: cloneStages(stages),
    failure: failure === null ? null : { ...failure },
  };
}

/**
 * Race a port promise against the shared round signal so an uncooperative
 * provider cannot hold the round open. A rejection handler is always attached,
 * so a late settle neither mutates state nor becomes an unhandled rejection:
 * the already-aborted path observes the abandoned promise before it rejects.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // A port that aborts synchronously may still return an already-rejected (or
    // later-rejected) promise; observe and ignore it so no unhandled rejection
    // escapes while the round only records its own cancellation.
    void Promise.resolve(promise).then(undefined, () => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const detach = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      detach();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        detach();
        resolve(value);
      },
      (error: unknown) => {
        detach();
        reject(error);
      },
    );
  });
}

/** Read a plain own-data record whose keys are exactly `keys`, else `null`. */
function readExactDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || !names.every((name) => keys.includes(name))) return null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      return null;
    }
  }
  return value as Record<string, unknown>;
}

function isValidMime(value: string): boolean {
  if (value.length < 1 || value.length > MAX_MIME_LENGTH) return false;
  if (CONTROL_CHAR_PATTERN.test(value)) return false;
  const slash = value.indexOf('/');
  return slash > 0 && slash < value.length - 1;
}

function sessionMatchesMode(sessionId: string, mode: RuntimeMode): boolean {
  const expected = mode === 'live' ? 'owner-live' : 'owner-development-mock';
  return sessionId === expected;
}

function fingerprintOf(bytes: Uint8Array, mime: string): string {
  const hash = createHash('sha256');
  // Frame the byte length first so the bytes tail and the media type cannot be
  // re-split ambiguously across two different (bytes, mime) pairs.
  hash.update(`${bytes.byteLength}:`, 'utf8');
  hash.update(bytes);
  hash.update(mime, 'utf8');
  return hash.digest('hex');
}

function acceptStoredAudio(value: unknown): StoredAudio {
  const record = readExactDataRecord(value, STORED_AUDIO_KEYS);
  if (record === null) throw makeRoundError('invalid_result', 'intake');
  const checked = validateAudioAsset(record['asset']);
  if (!checked.ok) throw makeRoundError('invalid_result', 'intake');
  const assetId = checked.value.asset_id;
  if (!UUID_V4_PATTERN.test(assetId)) {
    throw makeRoundError('invalid_result', 'intake');
  }
  const storageKey = record['storage_key'];
  if (typeof storageKey !== 'string' || storageKey !== assetId) {
    throw makeRoundError('invalid_result', 'intake');
  }
  return { asset: structuredClone(checked.value), storage_key: storageKey };
}

/** Validate the intake metadata and both distinct private assets before use. */
function acceptIntakeResult(raw: unknown): { original: StoredAudio; analysis: StoredAudio } {
  const record = readExactDataRecord(raw, INTAKE_KEYS);
  if (record === null) throw makeRoundError('invalid_result', 'intake');
  const original = acceptStoredAudio(record['original']);
  const analysis = acceptStoredAudio(record['analysis']);
  if (original.asset.asset_id === analysis.asset.asset_id) {
    throw makeRoundError('invalid_result', 'intake');
  }
  if (
    analysis.asset.media_type !== ANALYSIS_MEDIA_TYPE
    || analysis.asset.sample_rate_hz !== ANALYSIS_SAMPLE_RATE_HZ
    || analysis.asset.channels !== ANALYSIS_CHANNELS
  ) {
    throw makeRoundError('invalid_result', 'intake');
  }
  if (
    original.asset.duration_ms > MAX_SOURCE_DURATION_MS
    || analysis.asset.duration_ms > MAX_ANALYSIS_DURATION_MS
  ) {
    throw makeRoundError('invalid_result', 'intake');
  }
  return { original, analysis };
}

function parseSubmit(input: unknown): ParsedSubmit {
  const record = readExactDataRecord(input, SUBMIT_KEYS);
  if (record === null) throw makeRoundError('invalid_input', 'intake');
  const sessionId = record['session_id'];
  const requestId = record['client_request_id'];
  const submission = readExactDataRecord(record['submission'], SUBMISSION_KEYS);
  if (submission === null) throw makeRoundError('invalid_input', 'intake');
  if (typeof sessionId !== 'string' || !ID_PATTERN.test(sessionId)) {
    throw makeRoundError('invalid_input', 'intake');
  }
  if (typeof requestId !== 'string' || !UUID_V4_PATTERN.test(requestId)) {
    throw makeRoundError('invalid_input', 'intake');
  }
  const bytes = submission['bytes'];
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_CLIP_BYTES) {
    throw makeRoundError('invalid_input', 'intake');
  }
  const mime = submission['declared_media_type'];
  if (typeof mime !== 'string' || !isValidMime(mime)) {
    throw makeRoundError('invalid_input', 'intake');
  }
  return { sessionId, requestId, bytes: new Uint8Array(bytes), mime };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RoundService {
  private readonly intake: AudioIntakePort;
  private readonly analysis: LocalAudioAnalysisPort;
  private readonly dialogue: DialoguePort;
  private readonly synthesis: SpeechSynthesisPort;
  private readonly store: ConversationStorePort;
  private readonly mode: RuntimeMode;
  private readonly deadlineMs: number;
  private readonly jobs = new Map<string, JobEntry>();
  private readonly requestKeys = new Map<string, string>();

  constructor(deps: RoundServiceDeps) {
    const input: unknown = deps;
    if (typeof input !== 'object' || input === null) {
      throw new Error('RoundService requires its port dependencies');
    }
    const config = input as Record<string, unknown>;
    const mode = config['mode'];
    if (mode !== 'live' && mode !== 'development-mock') {
      throw new Error('RoundService mode must be "live" or "development-mock"');
    }
    const configured = config['deadlineMs'];
    const deadlineMs = configured === undefined ? DEFAULT_DEADLINE_MS : configured;
    if (
      typeof deadlineMs !== 'number'
      || !Number.isSafeInteger(deadlineMs)
      || deadlineMs < 1
      || deadlineMs > MAX_DEADLINE_MS
    ) {
      throw new Error('RoundService deadlineMs must be an integer between 1 and 120000');
    }
    this.intake = config['intake'] as AudioIntakePort;
    this.analysis = config['analysis'] as LocalAudioAnalysisPort;
    this.dialogue = config['dialogue'] as DialoguePort;
    this.synthesis = config['synthesis'] as SpeechSynthesisPort;
    this.store = config['store'] as ConversationStorePort;
    this.mode = mode;
    this.deadlineMs = deadlineMs;
  }

  /**
   * Validate, snapshot and enqueue one round, then start processing. Rejects
   * `invalid_input` for malformed or reused-with-different-bytes input and
   * `busy` when a distinct round is already active. An identical resubmission
   * returns the existing job even while it is still busy.
   */
  submit(input: SubmitRequest): RoundJob {
    const parsed = parseSubmit(input);
    if (!sessionMatchesMode(parsed.sessionId, this.mode)) {
      throw makeRoundError('invalid_input', 'intake');
    }
    const fingerprint = fingerprintOf(parsed.bytes, parsed.mime);
    const requestKey = `${parsed.sessionId}:${parsed.requestId}`;
    const existingId = this.requestKeys.get(requestKey);
    if (existingId !== undefined) {
      const existing = this.jobs.get(existingId);
      if (existing !== undefined) {
        if (existing.fingerprint === fingerprint) return cloneJob(existing.job);
        throw makeRoundError('invalid_input', 'intake');
      }
    }
    for (const entry of this.jobs.values()) {
      if (isActiveStatus(entry.job.status)) throw makeRoundError('busy', 'intake');
    }
    const job: RoundJob = {
      job_id: randomUUID(),
      turn_id: randomUUID(),
      session_id: parsed.sessionId,
      client_request_id: parsed.requestId,
      mode: this.mode,
      status: 'queued',
      stage: 'intake',
      record: null,
      failure: null,
      persisted: false,
    };
    const entry: JobEntry = {
      job,
      fingerprint,
      request_key: requestKey,
      created_at_ms: Date.now(),
    };
    this.jobs.set(job.job_id, entry);
    this.requestKeys.set(requestKey, job.job_id);
    this.evict();
    const snapshot = cloneJob(job);
    void this.run(entry, parsed.bytes, parsed.mime);
    return snapshot;
  }

  /** Independent clone of the current job state, or `null` when unknown. */
  getJob(jobId: string): RoundJob | null {
    if (typeof jobId !== 'string') return null;
    const entry = this.jobs.get(jobId);
    return entry === undefined ? null : cloneJob(entry.job);
  }

  /** Read one stored turn, validated for identifiers, session, turn and mode. */
  async getTurn(sessionId: string, turnId: string): Promise<TurnRecord | null> {
    const ids = this.lookupIds(sessionId, turnId);
    let raw: unknown = null;
    try {
      raw = await this.store.getTurn(ids.sessionId, ids.turnId);
    } catch (error) {
      if (toRoundFailure(error, 'storage').code === 'not_found') return null;
      throw makeRoundError('storage_failed', 'storage');
    }
    if (raw === null || raw === undefined) return null;
    return this.acceptStoredTurn(raw, ids.sessionId, ids.turnId);
  }

  /** Delegate playback completion to the store and require a played output. */
  async markPlaybackCompleted(sessionId: string, turnId: string): Promise<TurnRecord> {
    const ids = this.lookupIds(sessionId, turnId);
    let raw: unknown = null;
    try {
      raw = await this.store.markPlaybackCompleted(ids.sessionId, ids.turnId);
    } catch (error) {
      throw this.storeFailure(error);
    }
    if (raw === null || raw === undefined) throw makeRoundError('not_found', 'storage');
    const record = this.acceptStoredTurn(raw, ids.sessionId, ids.turnId);
    if (record.playback_completed !== true || record.output_asset === null) {
      throw makeRoundError('invalid_result', 'storage');
    }
    return record;
  }

  // -- internals ------------------------------------------------------------

  private async run(entry: JobEntry, bytes: Uint8Array, mime: string): Promise<void> {
    const controller = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort(makeRoundError('timed_out', 'intake'));
    }, this.deadlineMs);
    entry.job.status = 'processing';
    try {
      await this.execute(entry, bytes, mime, controller.signal);
    } catch {
      // Unreachable safety net: every stage reduces its own failure and returns.
      entry.job.record = null;
      entry.job.persisted = false;
      entry.job.failure = toRoundFailure(
        makeRoundError('provider_failed', entry.job.stage),
        entry.job.stage,
      );
      entry.job.status = 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  private async execute(
    entry: JobEntry,
    bytes: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<void> {
    entry.job.stage = 'intake';
    const intakeOutcome = await this.stage('intake', signal, async () => {
      const raw = await raceAbort(
        this.intake.ingest({ bytes, declared_media_type: mime }, { signal }),
        signal,
      );
      return acceptIntakeResult(raw);
    });
    if (!intakeOutcome.ok) {
      this.finishWithoutRecord(entry, intakeOutcome.failure);
      return;
    }
    const intake = intakeOutcome.value;
    const parts: Parts = {
      sourceAsset: intake.original.asset,
      inputAsset: intake.analysis.asset,
      annotation: null,
      draft: null,
      plan: null,
      outputAsset: null,
      outputAlignment: null,
      appliedControls: [],
      unsupportedControls: [],
    };
    const stages: Partial<Record<RoundStage, StageOutcome>> = { intake: { status: 'ok' } };
    const inputAsset = intake.analysis.asset;
    const analysisStored: StoredAudio = {
      asset: structuredClone(inputAsset),
      storage_key: intake.analysis.storage_key,
    };
    const sourceAssetId = intake.original.asset.asset_id;
    const inputAssetId = inputAsset.asset_id;

    entry.job.stage = 'analysis';
    const analysisOutcome = await this.stage('analysis', signal, async () => {
      const raw = await raceAbort(this.analysis.analyze(analysisStored, { signal }), signal);
      const checked = validateAnnotatedAudio(raw, inputAsset);
      if (!checked.ok) throw makeRoundError('invalid_result', 'analysis');
      this.assertAnnotationJsonSafe(entry, intake.original.asset, inputAsset, checked.value);
      return structuredClone(checked.value);
    });
    if (!analysisOutcome.ok) {
      stages.analysis = outcomeFor(analysisOutcome.failure);
      await this.finalizeFailure(entry, parts, stages, analysisOutcome.failure);
      return;
    }
    const annotation = analysisOutcome.value;
    parts.annotation = annotation;
    stages.analysis = { status: 'ok' };

    entry.job.stage = 'context';
    const contextOutcome = await this.stage('context', signal, async () => {
      const persona = await raceAbort(this.store.loadPersona(), signal);
      const preferences = await raceAbort(
        this.store.loadPreferences(entry.job.session_id),
        signal,
      );
      const history = await raceAbort(
        this.store.recentHistory(entry.job.session_id, HISTORY_LIMIT),
        signal,
      );
      return buildDialogueContext({ asset: inputAsset, annotation, persona, preferences, history });
    });
    if (!contextOutcome.ok) {
      stages.context = outcomeFor(contextOutcome.failure);
      await this.finalizeFailure(entry, parts, stages, contextOutcome.failure);
      return;
    }
    const context = contextOutcome.value;
    stages.context = { status: 'ok' };

    entry.job.stage = 'dialogue';
    const draftOutcome = await this.stage('dialogue', signal, async () => {
      const raw = await raceAbort(this.dialogue.generate(context, { signal }), signal);
      const checked = validateReplyDraft(raw);
      if (!checked.ok) throw makeRoundError('invalid_result', 'dialogue');
      return structuredClone(checked.value);
    });
    if (!draftOutcome.ok) {
      stages.dialogue = outcomeFor(draftOutcome.failure);
      await this.finalizeFailure(entry, parts, stages, draftOutcome.failure);
      return;
    }
    const draft = draftOutcome.value;
    parts.draft = draft;
    stages.dialogue = { status: 'ok' };

    entry.job.stage = 'expression';
    const planOutcome = await this.stage('expression', signal, async () => (
      buildReplyPlan(draft, randomUUID())
    ));
    if (!planOutcome.ok) {
      stages.expression = outcomeFor(planOutcome.failure);
      await this.finalizeFailure(entry, parts, stages, planOutcome.failure);
      return;
    }
    const plan = planOutcome.value;
    parts.plan = plan;
    stages.expression = { status: 'ok' };

    entry.job.stage = 'synthesis';
    const speechOutcome = await this.stage('synthesis', signal, async () => {
      const raw = await raceAbort(this.synthesis.synthesize(plan, { signal }), signal);
      const checked = validateGeneratedSpeech(raw, draft.reply_text);
      if (!checked.ok) throw makeRoundError('invalid_result', 'synthesis');
      const speech = structuredClone(checked.value);
      if (speech.asset.asset_id === sourceAssetId || speech.asset.asset_id === inputAssetId) {
        throw makeRoundError('invalid_result', 'synthesis');
      }
      return speech;
    });
    if (!speechOutcome.ok) {
      stages.synthesis = outcomeFor(speechOutcome.failure);
      await this.finalizeFailure(entry, parts, stages, speechOutcome.failure);
      return;
    }
    const speech = speechOutcome.value;
    parts.outputAsset = speech.asset;
    parts.outputAlignment = speech.alignment;
    parts.appliedControls = speech.applied_controls.slice();
    parts.unsupportedControls = speech.unsupported_controls.slice();
    stages.synthesis = { status: 'ok' };

    entry.job.stage = 'storage';
    await this.finalize(entry, parts, stages, null);
  }

  private async stage<T>(
    name: RoundStage,
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<StageResult<T>> {
    if (signal !== undefined && signal.aborted) {
      return { ok: false, failure: toRoundFailure(signal.reason, name, signal) };
    }
    try {
      const value = await run();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, failure: toRoundFailure(error, name, signal) };
    }
  }

  /**
   * Reject an accepted annotation that the strict turn-record JSON preflight
   * would refuse later (for example an explicitly `undefined` optional field,
   * which the annotation validator tolerates). It runs the same bounded
   * preflight used for storage against a provisional record that keeps the safe
   * source/input metadata and the raw annotation while every other part is null,
   * so an invalid annotation fails at analysis and the valid intake record stays
   * available instead of being lost at storage time.
   */
  private assertAnnotationJsonSafe(
    entry: JobEntry,
    sourceAsset: AudioAsset,
    inputAsset: AudioAsset,
    annotation: AnnotatedAudio,
  ): void {
    const provisional = buildTurnRecord(
      entry.job,
      entry.created_at_ms,
      this.mode,
      {
        sourceAsset,
        inputAsset,
        annotation,
        draft: null,
        plan: null,
        outputAsset: null,
        outputAlignment: null,
        appliedControls: [],
        unsupportedControls: [],
      },
      { intake: { status: 'ok' }, analysis: { status: 'ok' } },
      null,
    );
    if (!validateTurnRecord(provisional).ok) {
      throw makeRoundError('invalid_result', 'analysis');
    }
  }

  /** Mark every stage after a failure as explicitly skipped before persisting. */
  private async finalizeFailure(
    entry: JobEntry,
    parts: Parts,
    stages: Partial<Record<RoundStage, StageOutcome>>,
    failure: RoundFailure,
  ): Promise<void> {
    for (const stage of STAGE_ORDER) {
      if (stage === 'storage' || stage === 'complete') continue;
      if (stages[stage] === undefined) {
        stages[stage] = { status: 'skipped', reason: SKIPPED_REASON };
      }
    }
    await this.finalize(entry, parts, stages, failure);
  }

  /**
   * Build one validated terminal record, persist it exactly once through a
   * bounded store call and publish the outcome. `failure` is null only for a
   * fully succeeded round; a partial failure record still keeps every valid
   * annotation/draft/plan field it produced.
   */
  private async finalize(
    entry: JobEntry,
    parts: Parts,
    stages: Partial<Record<RoundStage, StageOutcome>>,
    failure: RoundFailure | null,
  ): Promise<void> {
    const completeOutcome: StageOutcome = failure === null
      ? { status: 'ok' }
      : { status: 'skipped', reason: SKIPPED_REASON };
    const diskStages = cloneStages(stages);
    diskStages.storage = { status: 'ok' };
    diskStages.complete = completeOutcome;
    const candidate = buildTurnRecord(
      entry.job,
      entry.created_at_ms,
      this.mode,
      parts,
      diskStages,
      failure,
    );
    const checked = validateTurnRecord(candidate);
    if (!checked.ok) {
      this.finishStorageFailure(
        entry,
        parts,
        stages,
        toRoundFailure(makeRoundError('invalid_result', 'storage'), 'storage'),
        INTERNAL_FAILURE_REASON,
      );
      return;
    }
    const stored = structuredClone(checked.value);
    let saved = true;
    try {
      await this.saveBounded(structuredClone(stored));
    } catch {
      saved = false;
    }
    if (saved) {
      entry.job.record = stored;
      entry.job.failure = failure;
      entry.job.persisted = true;
      entry.job.status = failure === null ? 'complete' : 'failed';
      entry.job.stage = failure === null ? 'complete' : failure.stage;
      return;
    }
    this.finishStorageFailure(
      entry,
      parts,
      stages,
      toRoundFailure(makeRoundError('storage_failed', 'storage'), 'storage'),
      STORAGE_FAILURE_REASON,
    );
  }

  /**
   * Storage failed or an ambiguous write could not be confirmed: the round is
   * failed, `persisted` stays false and storage/complete are marked failed while
   * the fields already produced stay available.
   */
  private finishStorageFailure(
    entry: JobEntry,
    parts: Parts,
    stages: Partial<Record<RoundStage, StageOutcome>>,
    failure: RoundFailure,
    reason: string,
  ): void {
    const failedStages = cloneStages(stages);
    failedStages.storage = { status: 'failed', reason };
    failedStages.complete = { status: 'failed', reason };
    const record = buildTurnRecord(
      entry.job,
      entry.created_at_ms,
      this.mode,
      parts,
      failedStages,
      failure,
    );
    const checked = validateTurnRecord(record);
    entry.job.record = checked.ok ? structuredClone(checked.value) : null;
    entry.job.failure = failure;
    entry.job.persisted = false;
    entry.job.status = 'failed';
    entry.job.stage = 'storage';
  }

  private finishWithoutRecord(entry: JobEntry, failure: RoundFailure): void {
    entry.job.record = null;
    entry.job.failure = failure;
    entry.job.persisted = false;
    entry.job.status = 'failed';
    entry.job.stage = failure.stage;
  }

  /**
   * Persist once through the store's signal-less port, bounded independently of
   * the round deadline, with no retry. A late settle after the bound is ignored
   * and never reported as a confirmed write.
   */
  private saveBounded(record: TurnRecord): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (settle: () => void): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        settle();
      };
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        finish(() => reject(makeRoundError('timed_out', 'storage')));
      }, STORE_TIMEOUT_MS);
      let pending: Promise<void>;
      try {
        pending = this.store.saveTurn(record);
      } catch {
        finish(() => reject(makeRoundError('storage_failed', 'storage')));
        return;
      }
      pending.then(
        () => finish(resolve),
        () => finish(() => reject(makeRoundError('storage_failed', 'storage'))),
      );
    });
  }

  private lookupIds(sessionId: string, turnId: string): { sessionId: string; turnId: string } {
    if (
      typeof sessionId !== 'string'
      || !ID_PATTERN.test(sessionId)
      || !sessionMatchesMode(sessionId, this.mode)
    ) {
      throw makeRoundError('invalid_result', 'storage');
    }
    if (typeof turnId !== 'string' || !UUID_V4_PATTERN.test(turnId)) {
      throw makeRoundError('invalid_result', 'storage');
    }
    return { sessionId, turnId };
  }

  private acceptStoredTurn(raw: unknown, sessionId: string, turnId: string): TurnRecord {
    const checked = validateTurnRecord(raw);
    if (!checked.ok) throw makeRoundError('invalid_result', 'storage');
    const record = checked.value;
    if (
      record.session_id !== sessionId
      || record.turn_id !== turnId
      || record.mode !== this.mode
    ) {
      throw makeRoundError('invalid_result', 'storage');
    }
    return structuredClone(record);
  }

  private storeFailure(error: unknown): Error {
    const failure = toRoundFailure(error, 'storage');
    return makeRoundError(
      failure.code === 'not_found' ? 'not_found' : 'storage_failed',
      'storage',
    );
  }

  /** Evict oldest terminal jobs only; an all-active cache is left intact. */
  private evict(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    for (const [jobId, entry] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (isActiveStatus(entry.job.status)) continue;
      this.jobs.delete(jobId);
      if (this.requestKeys.get(entry.request_key) === jobId) {
        this.requestKeys.delete(entry.request_key);
      }
    }
  }
}
