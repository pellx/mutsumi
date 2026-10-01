/**
 * M03 - provider-independent conversation and round domain types.
 *
 * Contract source: docs/contracts.md and the M03 assignment in
 * docs/sleep-work-plan.md. Types only: no validators, provider implementations,
 * timers, filesystem access or NestJS decorators. Erasable TypeScript syntax
 * only, so it runs unchanged under Node's built-in type stripping.
 *
 * Boundaries:
 * - These are domain data, not tool instructions; the application must bound
 *   the content before it reaches any model prompt.
 * - Persona and preferences are owner-authored configuration. The current
 *   transcript and history are quoted, untrusted conversational speech.
 * - Planned expression timing is not measured audio timing. Timing that refers
 *   to generated audio keeps explicit provenance and cannot be reconstructed
 *   from a reply plan alone.
 * - Missing capability is an explicit gap, never fabricated data.
 * - No raw provider payload, secret configuration, storage path or private
 *   reference appears in the public record types below.
 */

import type {
  AnnotatedAudio,
  AudioAsset,
  Observation,
  TimedUnit,
} from './annotation.ts';

// ---------------------------------------------------------------------------
// Persona and owner-authored configuration
// ---------------------------------------------------------------------------

/** Owner-authored persona configuration; distinct from quoted user speech. */
export type Persona = {
  persona_id: string;
  name: string;
  instructions: string[];
};

/** An explicit owner preference. Never an inferred emotion or fact. */
export type OwnerPreference = {
  key: string;
  value: string;
};

// ---------------------------------------------------------------------------
// Bounded dialogue context
// ---------------------------------------------------------------------------

/** One prior completed turn kept in bounded conversational history. */
export type HistoryTurn = {
  turn_id: string;
  user_text: string;
  assistant_text: string | null;
  assistant_playback_completed: boolean;
};

/**
 * Application-bounded context for dialogue generation. `current` and `history`
 * are untrusted quoted speech, not tool instructions. `capability_gaps` names
 * analysis dimensions that were explicitly unavailable for the current input.
 */
export type DialogueContext = {
  persona: Persona;
  preferences: OwnerPreference[];
  current: {
    transcript: string;
    observations: Observation[];
    capability_gaps: string[];
  };
  history: HistoryTurn[];
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Reply text, expression plan and generated output
// ---------------------------------------------------------------------------

/**
 * A planned expression segment. `emotion_intensity` is a planned 0..1 target,
 * not a recognition probability. `pace` is a planned relative speed and
 * `pause_after_ms` is an intended pause in milliseconds. Neither is an actual
 * speech boundary.
 */
export type ReplyExpressionSegment = {
  text: string;
  tone: string;
  emotion_intensity: number;
  pace: number | null;
  pause_after_ms: number | null;
};

/** Draft text with ordered expression segments whose text covers the draft. */
export type ReplyDraft = {
  reply_text: string;
  segments: ReplyExpressionSegment[];
};

/** Expression intention with a stable id. A plan only; no measured timing. */
export type ReplyPlan = {
  reply_id: string;
  segments: ReplyExpressionSegment[];
};

/**
 * Timing for actual generated audio. `units` and `source` retain provider or
 * alignment provenance; this is not derivable from a ReplyPlan alone.
 */
export type OutputAlignment = {
  units: TimedUnit[];
  source: string;
};

/**
 * Generated speech for one reply. `storage_key` is server-internal and must
 * never reach the browser or a history context. Applied and unsupported
 * controls are kept explicit so a plan is never reported as a measured result.
 */
export type GeneratedSpeech = {
  asset: AudioAsset;
  storage_key: string;
  alignment: OutputAlignment | null;
  applied_controls: string[];
  unsupported_controls: string[];
};

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/** Runtime provenance. `development-mock` output is labelled and proves nothing about live voice quality. */
export type RuntimeMode = 'live' | 'development-mock';

/** Ordered processing stages for a single complete-turn round. */
export type RoundStage =
  | 'intake'
  | 'analysis'
  | 'context'
  | 'dialogue'
  | 'expression'
  | 'synthesis'
  | 'storage'
  | 'complete';

/** Stable, safe round failure codes. Never a raw provider error string. */
export type RoundFailureCode =
  | 'invalid_input'
  | 'busy'
  | 'not_found'
  | 'provider_unavailable'
  | 'cancelled'
  | 'timed_out'
  | 'provider_failed'
  | 'invalid_result'
  | 'storage_failed';

/** A round failure. `message` is a safe static description, never provider exception text, paths, keys or URLs. */
export type RoundFailure = {
  code: RoundFailureCode;
  stage: RoundStage;
  message: string;
  retryable: boolean;
};

/** Stage outcome. `unavailable`/`skipped` differ from a completed stage; reasons must be safe. */
export type StageOutcome = {
  status: 'ok' | 'unavailable' | 'failed' | 'skipped';
  reason?: string;
};

// ---------------------------------------------------------------------------
// Public round record
// ---------------------------------------------------------------------------

/**
 * Public record for one processed round. `source_asset` (original) and
 * `input_asset` (normalized analysis input) are distinct asset ids on one
 * clip-relative clock. Partial `stages` retain any valid annotation and mark
 * unavailable stages explicitly. No raw provider payload, storage path or
 * private reference appears in this record.
 */
export type TurnRecord = {
  turn_id: string;
  session_id: string;
  client_request_id: string;
  created_at_ms: number;
  mode: RuntimeMode;
  source_asset: AudioAsset;
  input_asset: AudioAsset;
  annotation: AnnotatedAudio | null;
  reply_draft: ReplyDraft | null;
  reply_plan: ReplyPlan | null;
  output_asset: AudioAsset | null;
  output_alignment: OutputAlignment | null;
  applied_controls: string[];
  unsupported_controls: string[];
  playback_completed: boolean;
  stages: Partial<Record<RoundStage, StageOutcome>>;
  failure: RoundFailure | null;
};
