/**
 * M02a - separate server-internal audio publication and analysis ports.
 *
 * Scope: interface/type declarations only. No implementations, mocks, HTTP or
 * NestJS wiring, no vendor SDK imports and no credentials or config values.
 * Concrete adapters implement these ports: Alibaba model-bound temporary upload
 * now (owner-managed OSS later) for publication, and the qwen3-asr-flash-filetrans
 * asynchronous REST adapter for analysis.
 *
 * Boundaries implemented by this contract:
 * - `storage_key` and `RemoteAudioReference` are server-internal capability data.
 *   They never enter the strict `AudioAsset` schema, the browser, logs, or
 *   dialogue context.
 * - Native `AbortSignal` carries the shared operation deadline/cancellation; this
 *   module invents no timer, retry or polling behavior.
 * - Provider text units keep their true granularity, durations derive from
 *   end-minus-start, and sentence emotion is not independent per-character
 *   emotion. Unsupported prosody/sound-event capabilities stay unavailable.
 */

import type { AnnotatedAudio, AudioAsset } from '../domain/annotation.js';

/** A validated local asset paired with the opaque key that resolves it in local storage. */
export type StoredAudio = {
  readonly asset: AudioAsset;
  /** Opaque server-internal identifier resolved by local storage; never a browser-supplied absolute path. */
  readonly storage_key: string;
};

/**
 * Server-internal, capability-bearing reference to remotely published audio.
 * Never logged, returned to the browser, or included in dialogue context.
 */
export type RemoteAudioReference = {
  readonly uri: string;
  readonly model: string;
  /** Epoch milliseconds; `null` means unspecified, not infinite. */
  readonly expires_at_ms: number | null;
  readonly transport: 'https' | 'oss-resource';
};

/**
 * Uploads/resolves an opaque stored clip and returns a remote reference.
 * Does not submit an ASR job. Caller passes the supported ASR model; temporary
 * uploads bind to that model. No delete guarantee: temporary provider storage
 * exposes no deletion, so lifetime policy stays adapter-specific.
 */
export type AudioPublicationPort = {
  publish(
    audio: StoredAudio,
    options: { readonly model: string; readonly signal: AbortSignal },
  ): Promise<RemoteAudioReference>;
};

/**
 * Owns submit/poll/download/map under bounded waits with no blind retry of a
 * billed submission, and rejects a remote model mismatch before submitting.
 * Does not upload local files and does not generate replies or TTS. Missing
 * measured text timing on spoken units is reported as an analysis failure for
 * this first-version requirement, not accepted as complete success; a silent
 * successful transcription with empty text and no units is a distinct case.
 */
export type AudioAnalysisPort = {
  analyze(
    audio: AudioAsset,
    remote: RemoteAudioReference,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio>;
};

export type AnalysisFailureCode =
  | 'invalid_audio'
  | 'publication_failed'
  | 'model_mismatch'
  | 'submission_failed'
  | 'provider_failed'
  | 'timed_out'
  | 'cancelled'
  | 'invalid_result'
  | 'timing_unavailable';

/**
 * Error-conversion contract for future concrete adapters. `message` must be
 * safe text only: no URL, signature, raw provider response or key.
 */
export type AnalysisFailure = {
  code: AnalysisFailureCode;
  stage: 'publication' | 'transcription';
  message: string;
  retryable: boolean;
};

/**
 * M02/D20 - independent timing calibration port.
 *
 * Provides word/character-level unit timing for the same original AudioAsset
 * (same clock, same duration) via a separate analysis pass. The supervisor
 * application wires this alongside the primary publication + analysis so that
 * a single primary deadline covers both calls; the consuming mapper verifies
 * lexical coverage, provenance and boundary compatibility before fusion.
 *
 * Contract:
 * - Returns a validated AnnotatedAudio for the SAME asset_id/clock, carrying
 *   supported positive unit timing. It does NOT mutate or re-interpret the
 *   primary analysis result.
 * - The port implementation must NOT introduce vendor SDK types, timers, or
 *   inferred/interpolated times; it reports only independently measured or
 *   provider-reported timing.
 * - Cancellation is propagated via the supplied AbortSignal which carries the
 *   primary analysis deadline.
 * - A rejected or invalid result signals the mapper to fall through to the
 *   existing failure path; this port never silently degrades.
 */
export type AudioTimingCalibrationPort = {
  calibrate(
    audio: AudioAsset,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio>;
};

/**
 * M02/D21 - provider-independent local audio analysis port.
 *
 * Lets an adapter analyze a stored clip directly: it may resolve the opaque
 * `storage_key` against authorized local storage and submit inline bytes
 * under the bounded caller-supplied `AbortSignal`. Unlike the publication +
 * remote-reference flow (`AudioPublicationPort` plus `AudioAnalysisPort`),
 * this port requires neither a signed remote reference nor temporary
 * object-store publication.
 *
 * Contract:
 * - Inputs must already have validated metadata and storage authorization.
 *   A browser cannot supply filesystem paths; only the server resolves the
 *   opaque key, and it never enters public annotation objects or logs.
 * - Timing must preserve explicit provider-estimate provenance. An adapter
 *   never claims forced alignment, never fabricates missing bounds and
 *   never invokes a second recognizer silently; independent calibration
 *   stays observable through `AudioTimingCalibrationPort`.
 * - Sentence emotion links belong to the sentence span only. They are not
 *   independent per-unit or per-character emotion.
 * - Results follow the accepted `AnnotatedAudio` validation. Failures
 *   surface as errors, never as a partially invented annotation.
 */
export type LocalAudioAnalysisPort = {
  analyze(
    audio: StoredAudio,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio>;
};
