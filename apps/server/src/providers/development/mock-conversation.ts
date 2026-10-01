/**
 * M03 - opt-in development-only provider adapters with visible fixtures.
 *
 * These adapters let a complete round run offline. They are deliberately
 * trivial: none of them reads, transcribes, analyses or synthesizes the
 * submitted recording, so a green run through them proves structure only.
 * Every emitted value carries visible provenance: the transcript and reply
 * text are fixed labelled fixtures, word timing comes from a development
 * fixture unrelated to the recording, and the produced "audio" is silence.
 *
 * Boundaries:
 * - No credentials, network, provider SDK, filesystem path or environment
 *   access. The only IO is the injected AudioStoragePort.
 * - Failures are owned static round errors (application/round-errors.ts); a
 *   raw injected-store exception or message never reaches the caller.
 * - The silent WAV is generated reply output only: never an input voice
 *   recording, and never evidence of real speech-synthesis quality.
 */

import { randomUUID } from 'node:crypto';

import {
  validateAnnotatedAudio,
  validateAudioAsset,
  type AnnotatedAudio,
  type AudioAsset,
  type Capabilities,
  type TimedUnit,
  type TranscriptSegment,
} from '../../domain/annotation.ts';
import { validateReplyPlan } from '../../domain/conversation-validation.ts';
import type {
  DialogueContext,
  GeneratedSpeech,
  ReplyDraft,
  ReplyPlan,
  RoundStage,
} from '../../domain/conversation.ts';
import type {
  AudioStoragePort,
  DialoguePort,
  SpeechSynthesisPort,
} from '../../application/conversation-ports.ts';
import type {
  LocalAudioAnalysisPort,
  StoredAudio,
} from '../../application/analysis-ports.ts';
import { makeRoundError, toRoundFailure } from '../../application/round-errors.ts';

/** Visible provenance stamped onto every development-fixture value. */
const FIXTURE_PROVIDER = 'development';
const FIXTURE_MODEL = 'fixed-fixture';
const FIXTURE_TIMING_SOURCE = 'development-fixture-unrelated-to-recording';

/** Fixed fixture transcript with six fixed word units, 100 ms each over 0-600 ms. */
const FIXTURE_TRANSCRIPT = '开发模式仅供流程检查使用。';
const FIXTURE_WORDS: readonly string[] = ['开发', '模式', '仅供', '流程', '检查', '使用'];
const FIXTURE_UNIT_MS = 100;
const FIXTURE_SPAN_MS = FIXTURE_WORDS.length * FIXTURE_UNIT_MS;
const FIXTURE_SEGMENT_ID = 'development-fixture-segment';

/** Fixed fixture reply; the text itself is the visible development label. */
const FIXTURE_REPLY_TEXT = '这是开发模式的固定示例回复。';

/** Silent reply WAV geometry; the duration derives from the written sample count. */
const SILENT_SAMPLE_RATE_HZ = 16000;
const SILENT_CHANNELS = 1;
const SILENT_BITS_PER_SAMPLE = 16;
const SILENT_SAMPLE_COUNT = SILENT_SAMPLE_RATE_HZ;
const WAV_HEADER_BYTES = 44;

/**
 * Throw an owned cancelled/timed_out round error when the caller's shared
 * deadline has already fired. The signal reason is never re-exposed.
 */
function throwIfAborted(stage: RoundStage, signal: AbortSignal): void {
  if (signal.aborted) {
    throw makeRoundError(toRoundFailure(signal.reason, stage, signal).code, stage);
  }
}

/** Convert a storage throw into an owned round error without leaking its text. */
function storageRoundError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) {
    return makeRoundError(toRoundFailure(signal.reason, 'synthesis', signal).code, 'synthesis');
  }
  const failure = toRoundFailure(error, 'synthesis');
  return makeRoundError(
    failure.code === 'provider_failed' ? 'storage_failed' : failure.code,
    'synthesis',
  );
}

/** Store bytes under a validated asset, mapping any throw to an owned error. */
async function saveToStorage(
  storage: AudioStoragePort,
  bytes: Uint8Array,
  asset: AudioAsset,
  signal: AbortSignal,
): Promise<StoredAudio> {
  try {
    return await storage.save(bytes, asset);
  } catch (error) {
    throw storageRoundError(error, signal);
  }
}

/** The exact own-data shape a storage save may return: the asset and its key. */
const STORED_AUDIO_KEYS: readonly string[] = ['asset', 'storage_key'];

/**
 * Accept only a plain own-data `{ asset, storage_key }` record from the injected
 * store. Class instances, prototype-swapped objects, arrays, symbol keys,
 * accessors, non-enumerable own properties and extra fields are rejected, and
 * no field is read until its own enumerable data descriptor is confirmed, so a
 * hostile store cannot run a getter or smuggle a hidden field. Returns the two
 * raw field values, or `null` when the shape is unusable.
 */
function readStoredAudio(stored: unknown): { asset: unknown; storageKey: unknown } | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return null;
  }
  const prototype: unknown = Object.getPrototypeOf(stored);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  const record = stored as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(record).length > 0) {
    return null;
  }
  const names = Object.getOwnPropertyNames(record);
  if (names.length !== STORED_AUDIO_KEYS.length) {
    return null;
  }
  for (const key of names) {
    if (!STORED_AUDIO_KEYS.includes(key)) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !descriptor.enumerable) {
      return null;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      return null;
    }
  }
  return { asset: record['asset'], storageKey: record['storage_key'] };
}

/** Write ASCII tag bytes into a DataView without a literal NUL in this source. */
function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** Canonical 44-byte RIFF/WAVE header plus exactly SILENT_SAMPLE_COUNT zero samples. */
function buildSilentWav(): Uint8Array {
  const bytesPerSample = SILENT_BITS_PER_SAMPLE / 8;
  const blockAlign = SILENT_CHANNELS * bytesPerSample;
  const dataBytes = SILENT_SAMPLE_COUNT * blockAlign;
  const buffer = new Uint8Array(WAV_HEADER_BYTES + dataBytes); // samples stay zero-filled
  const view = new DataView(buffer.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // PCM format tag
  view.setUint16(22, SILENT_CHANNELS, true);
  view.setUint32(24, SILENT_SAMPLE_RATE_HZ, true);
  view.setUint32(28, SILENT_SAMPLE_RATE_HZ * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, SILENT_BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

/** Build the one fixed annotation fixture for an already validated asset. */
function buildFixtureAnnotation(asset: AudioAsset): AnnotatedAudio {
  const units: TimedUnit[] = FIXTURE_WORDS.map((text, index) => ({
    text,
    granularity: 'word',
    timing: {
      status: 'available',
      start_ms: index * FIXTURE_UNIT_MS,
      end_ms: (index + 1) * FIXTURE_UNIT_MS,
      source: FIXTURE_TIMING_SOURCE,
    },
  }));
  const segments: TranscriptSegment[] = [{
    segment_id: FIXTURE_SEGMENT_ID,
    text: FIXTURE_TRANSCRIPT,
    timing: {
      status: 'available',
      start_ms: 0,
      end_ms: FIXTURE_SPAN_MS,
      source: FIXTURE_TIMING_SOURCE,
    },
    units,
  }];
  const unavailable = (dimension: string): Capabilities['emotion'] => ({
    status: 'unavailable',
    reason: `Development fixture: no ${dimension} analysis is performed on the submitted recording.`,
  });
  const capabilities: Capabilities = {
    word_timing: { status: 'ok', source_provider: FIXTURE_PROVIDER, source_model: FIXTURE_MODEL },
    emotion: unavailable('emotion'),
    prosody: unavailable('prosody'),
    sound_event: unavailable('sound_event'),
  };
  return {
    schema_version: '0.1',
    asset_id: asset.asset_id,
    transcript: FIXTURE_TRANSCRIPT,
    segments,
    observations: [],
    capabilities,
  };
}

/**
 * Offline analysis: validates the asset, then returns a fixed annotation
 * fixture. The submitted waveform is never read and no recognition, emotion,
 * prosody or sound-event capability is claimed.
 */
export class DevelopmentAudioAnalysis implements LocalAudioAnalysisPort {
  async analyze(
    audio: StoredAudio,
    options: { readonly signal: AbortSignal },
  ): Promise<AnnotatedAudio> {
    throwIfAborted('analysis', options.signal);

    const assetResult = validateAudioAsset(audio.asset);
    if (!assetResult.ok) {
      throw makeRoundError('invalid_input', 'analysis');
    }
    const asset = assetResult.value;
    // The six fixed 100 ms units are not stretched, averaged or dropped to fit a
    // shorter clip, so any clip below the fixture span is explicitly unavailable.
    if (asset.duration_ms < FIXTURE_SPAN_MS) {
      throw makeRoundError('provider_unavailable', 'analysis');
    }

    const annotationResult = validateAnnotatedAudio(buildFixtureAnnotation(asset), asset);
    if (!annotationResult.ok) {
      throw makeRoundError('invalid_result', 'analysis');
    }
    return annotationResult.value;
  }
}

/**
 * Offline dialogue: returns one visibly labelled fixture draft. Owner persona,
 * preferences, history and quoted speech are never inspected for facts.
 */
export class DevelopmentDialogue implements DialoguePort {
  async generate(
    _context: DialogueContext,
    options: { readonly signal: AbortSignal },
  ): Promise<ReplyDraft> {
    throwIfAborted('dialogue', options.signal);
    return {
      reply_text: FIXTURE_REPLY_TEXT,
      segments: [
        {
          text: FIXTURE_REPLY_TEXT,
          tone: 'neutral',
          emotion_intensity: 0,
          pace: null,
          pause_after_ms: null,
        },
      ],
    };
  }
}

/**
 * Offline synthesis: validates the plan, writes one second of silent mono
 * 16 kHz 16-bit PCM through the injected storage, and reports every planned
 * control as unsupported. No words are spoken, so alignment stays null.
 */
export class DevelopmentSpeechSynthesis implements SpeechSynthesisPort {
  readonly #storage: AudioStoragePort;

  constructor({ storage }: { storage: AudioStoragePort }) {
    this.#storage = storage;
  }

  async synthesize(
    plan: ReplyPlan,
    options: { readonly signal: AbortSignal },
  ): Promise<GeneratedSpeech> {
    const { signal } = options;
    throwIfAborted('synthesis', signal);

    if (!validateReplyPlan(plan).ok) {
      throw makeRoundError('invalid_input', 'synthesis');
    }

    // Snapshot the generated bytes and metadata before any await. `expectedAsset`
    // is the local authority for what the store must return; only a copy is
    // handed to the injected store, so it cannot mutate the expected metadata.
    const bytes = buildSilentWav();
    const expectedAsset: AudioAsset = {
      asset_id: randomUUID(),
      media_type: 'audio/wav',
      duration_ms: Math.round((SILENT_SAMPLE_COUNT * 1000) / SILENT_SAMPLE_RATE_HZ),
      sample_rate_hz: SILENT_SAMPLE_RATE_HZ,
      channels: SILENT_CHANNELS,
    };

    throwIfAborted('synthesis', signal);
    const stored = await saveToStorage(this.#storage, bytes, { ...expectedAsset }, signal);
    throwIfAborted('synthesis', signal);

    // The store must return a plain { asset, storage_key } record whose asset is
    // valid and whose metadata and opaque key match the locally generated WAV.
    const storedFields = readStoredAudio(stored);
    if (storedFields === null) {
      throw makeRoundError('invalid_result', 'synthesis');
    }
    const storedAssetResult = validateAudioAsset(storedFields.asset);
    if (!storedAssetResult.ok) {
      throw makeRoundError('invalid_result', 'synthesis');
    }
    const storedAsset = storedAssetResult.value;
    const storedKey = typeof storedFields.storageKey === 'string' ? storedFields.storageKey : '';
    const metadataMatches =
      storedAsset.asset_id === expectedAsset.asset_id
      && storedAsset.media_type === expectedAsset.media_type
      && storedAsset.duration_ms === expectedAsset.duration_ms
      && storedAsset.sample_rate_hz === expectedAsset.sample_rate_hz
      && storedAsset.channels === expectedAsset.channels;
    if (storedKey !== expectedAsset.asset_id || !metadataMatches) {
      throw makeRoundError('invalid_result', 'synthesis');
    }

    return {
      asset: { ...storedAsset },
      storage_key: storedKey,
      alignment: null,
      applied_controls: [],
      unsupported_controls: ['tone', 'emotion_intensity', 'pace', 'pause_after_ms'],
    };
  }
}
