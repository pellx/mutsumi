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
