import type { StoredAudio } from './analysis-ports.js';
import type {
  AnnotatedAudio,
  AudioAsset,
  Capability,
  Observation,
  Timing,
  TranscriptSegment,
} from '../domain/annotation.js';

/** A transcript and optional overlapping background sound descriptions, without timed text units. */
export type UntimedTranscription = {
  readonly asset_id: string;
  readonly transcript: string;
  readonly source_provider: string;
  readonly source_model: string;
  readonly sound_events: readonly (Omit<Observation, 'kind'> & { readonly kind: 'sound_event' })[];
  readonly sound_event_capability: Capability;
};

export type TranscriptionPort = {
  transcribe(
    audio: StoredAudio,
    options: { readonly signal: AbortSignal },
  ): Promise<UntimedTranscription>;
};

/** Timing retains the complete normalized transcript and provider units; it never invents or divides bounds. */
export type TimingPort = {
  align(
    audio: StoredAudio,
    transcription: UntimedTranscription,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio>;
};

/** Immutable timed text projection passed to an emotion observer; it contains no storage paths. */
export type EmotionInput = {
  readonly asset_id: AudioAsset['asset_id'];
  readonly transcript: string;
  readonly segments: readonly {
    readonly segment_id: TranscriptSegment['segment_id'];
    readonly text: TranscriptSegment['text'];
    readonly speaker_id?: TranscriptSegment['speaker_id'];
    readonly timing: Readonly<Timing>;
    readonly units?: readonly {
      readonly text: NonNullable<TranscriptSegment['units']>[number]['text'];
      readonly granularity: NonNullable<TranscriptSegment['units']>[number]['granularity'];
      readonly timing: Readonly<Timing>;
    }[];
  }[];
};

/** Emotion observations reference existing segment IDs and do not replace transcript or timing. */
export type EmotionResult = {
  readonly asset_id: string;
  readonly observations: readonly (Omit<Observation, 'kind'> & { readonly kind: 'emotion' })[];
  readonly capability: Capability;
};

export type EmotionPort = {
  observe(
    audio: StoredAudio,
    alignment: EmotionInput,
    options: { readonly signal: AbortSignal },
  ): Promise<EmotionResult>;
};

export type InputStage = 'transcription' | 'timing' | 'emotion';

/** Runtime validators must enforce IDs, bounds, source and mutation protection; readonly types provide no runtime protection. */