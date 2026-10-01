/**
 * M02b - map Alibaba qwen3-asr-flash-filetrans result JSON into AnnotatedAudio.
 *
 * Contract sources: docs/aliyun-asr-integration.md ("Transcription adapter") and
 * docs/tasks/M02-filetrans-mapper.md. Only the downloaded transcription payload
 * is mapped here; submission, polling and download stay transport concerns, and
 * no vendor SDK type crosses this boundary.
 *
 * Notes:
 * - Spoken text requires measured word timing in this first version: a nonempty
 *   result without usable word timing is `timing_unavailable`, never accepted
 *   with invented, clamped or averaged times.
 * - Successful silence (empty transcript text, no sentences) is distinct and
 *   needs no timings.
 * - Provider word granularity is preserved, multi-character words are never
 *   split, punctuation never becomes a fabricated timed unit, and sentence
 *   emotion is preserved verbatim without an invented score.
 */

import { validateAnnotatedAudio, validateAudioAsset } from '../../domain/annotation.ts';
import type {
  AnnotatedAudio,
  AudioAsset,
  Capabilities,
  Observation,
  TimedUnit,
  TimingGranularity,
  TranscriptSegment,
} from '../../domain/annotation.ts';
import type { AnalysisFailure } from '../../application/analysis-ports.js';

export const FILETRANS_MODEL = 'qwen3-asr-flash-filetrans';

const SOURCE_PROVIDER = 'aliyun';
const TIMING_SOURCE = `aliyun:${FILETRANS_MODEL}`;
const MAX_TRANSCRIPTS = 1;
const MAX_SENTENCES = 10000;
const MAX_WORDS = 100000;

const INVALID_AUDIO_MESSAGE = 'audio asset is not a valid transcription input';
const INVALID_RESULT_MESSAGE = 'provider result is not a valid transcription payload for this model';
const TIMING_UNAVAILABLE_MESSAGE = 'provider result is missing measured word timing for spoken text';
const INVALID_ANNOTATION_MESSAGE = 'mapped transcription result is not valid annotated audio';
const EMOTION_UNAVAILABLE_REASON = 'provider returned no sentence emotion label for the transcribed speech';
const PROSODY_UNAVAILABLE_REASON = `prosody detection is not supported by ${FILETRANS_MODEL}`;
const SOUND_EVENT_UNAVAILABLE_REASON = `sound-event detection is not supported by ${FILETRANS_MODEL}`;

type PlainRecord = Record<string, unknown>;
type TimeRead = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'value'; ms: number };
type Failure = { ok: false; error: AnalysisFailure };
type Mapped = { ok: true; value: AnnotatedAudio } | Failure;

/** Canonical non-negative array index keys: `0`, `1`, ... (no leading zeros). */
const ARRAY_INDEX_KEY = /^(?:0|[1-9][0-9]*)$/;

function isInRangeIndexKey(key: string, length: number): boolean {
  return ARRAY_INDEX_KEY.test(key) && Number(key) < length;
}

/**
 * A plain JSON record: `Object.prototype`/`null` prototype, own enumerable data
 * properties only, no symbol keys, no getters/setters. Returns `null` so the
 * caller stops reading fields instead of triggering an accessor.
 */
function readRecord(value: unknown): PlainRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable) return null;
    if (descriptor.get !== undefined || descriptor.set !== undefined) return null;
  }
  return value as PlainRecord;
}

/** A dense ordinary `Array.prototype` array with no extra keys, holes or accessors. */
function readArray(value: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length: number = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return null;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !descriptor.enumerable) return null;
    if (descriptor.get !== undefined || descriptor.set !== undefined) return null;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length' || isInRangeIndexKey(key, length)) continue;
    return null;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  return value as unknown[];
}

/** Read an own enumerable data property; never invokes a getter. */
function field(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor === undefined || !descriptor.enumerable ? undefined : descriptor.value;
}

/** No coercion: only a safe integer counts as a usable time. */
function readTime(value: unknown): TimeRead {
  if (value === undefined || value === null) return { kind: 'missing' };
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { kind: 'invalid' };
  return { kind: 'value', ms: value };
}

const SINGLE_CODE_POINT_LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;

/** Text-unit size only: one Unicode letter or number is a character, else a word. */
function granularityFor(text: string): TimingGranularity {
  if (Array.from(text).length !== 1) return 'word';
  return SINGLE_CODE_POINT_LETTER_OR_NUMBER.test(text) ? 'character' : 'word';
}

function failure(code: AnalysisFailure['code'], message: string): Failure {
  return { ok: false, error: { code, stage: 'transcription', message, retryable: false } };
}

function okCapability(): { status: 'ok'; source_provider: string; source_model: string } {
  return { status: 'ok', source_provider: SOURCE_PROVIDER, source_model: FILETRANS_MODEL };
}

function availableTiming(startMs: number, endMs: number): {
  status: 'available';
  start_ms: number;
  end_ms: number;
  source: string;
} {
  return { status: 'available', start_ms: startMs, end_ms: endMs, source: TIMING_SOURCE };
}

function finalize(document: AnnotatedAudio, asset: AudioAsset): Mapped {
  const validated = validateAnnotatedAudio(document, asset);
  if (!validated.ok) return failure('invalid_result', INVALID_ANNOTATION_MESSAGE);
  return { ok: true, value: validated.value };
}

/** Successful silence: requested analysis ran, no speech, no observations. */
function buildSilence(asset: AudioAsset): AnnotatedAudio {
  const capabilities: Capabilities = {
    word_timing: okCapability(),
    emotion: okCapability(),
    prosody: { status: 'unavailable', reason: PROSODY_UNAVAILABLE_REASON },
    sound_event: { status: 'unavailable', reason: SOUND_EVENT_UNAVAILABLE_REASON },
  };
  return {
    schema_version: '0.1',
    asset_id: asset.asset_id,
    transcript: '',
    segments: [],
    observations: [],
    capabilities,
  };
}

export function mapFiletransResult(
  raw: unknown,
  asset: AudioAsset,
): { ok: true; value: AnnotatedAudio } | { ok: false; error: AnalysisFailure } {
  const validatedAsset = validateAudioAsset(asset);
  if (!validatedAsset.ok) return failure('invalid_audio', INVALID_AUDIO_MESSAGE);
  const audio = validatedAsset.value;

  const invalid = (): Failure => failure('invalid_result', INVALID_RESULT_MESSAGE);
  const timingUnavailable = (): Failure => failure('timing_unavailable', TIMING_UNAVAILABLE_MESSAGE);

  const root = readRecord(raw);
  if (root === null) return invalid();

  const transcripts = readArray(field(root, 'transcripts'), MAX_TRANSCRIPTS);
  if (transcripts === null || transcripts.length !== MAX_TRANSCRIPTS) return invalid();

  const transcript = readRecord(transcripts[0]);
  if (transcript === null) return invalid();

  const channelId = field(transcript, 'channel_id');
  if (channelId !== 0) return invalid();

  const transcriptText = field(transcript, 'text');
  if (typeof transcriptText !== 'string') return invalid();

  const sentences = readArray(field(transcript, 'sentences'), MAX_SENTENCES);
  if (sentences === null) return invalid();

  if (transcriptText.length === 0) {
    if (sentences.length > 0) return invalid();
    return finalize(buildSilence(audio), audio);
  }
  if (transcriptText.trim().length === 0) return invalid();
  if (sentences.length === 0) return invalid();

  const segments: TranscriptSegment[] = [];
  const observations: Observation[] = [];
  let labeledSentences = 0;
  let totalWords = 0;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = readRecord(sentences[index]);
    if (sentence === null) return invalid();

    const sentenceText = field(sentence, 'text');
    if (typeof sentenceText !== 'string' || sentenceText.trim().length === 0) return invalid();

    const begin = readTime(field(sentence, 'begin_time'));
    const end = readTime(field(sentence, 'end_time'));
    if (begin.kind !== 'value' || end.kind !== 'value') return invalid();
    if (begin.ms < 0 || end.ms > audio.duration_ms || begin.ms >= end.ms) return invalid();

    const wordsValue = field(sentence, 'words');
    if (wordsValue === undefined || wordsValue === null) return timingUnavailable();
    const words = readArray(wordsValue, MAX_WORDS);
    if (words === null) return invalid();
    if (words.length === 0) return timingUnavailable();
    totalWords += words.length;
    if (totalWords > MAX_WORDS) return invalid();

    const units: TimedUnit[] = [];
    for (const rawWord of words) {
      const word = readRecord(rawWord);
      if (word === null) return invalid();

      const wordText = field(word, 'text');
      if (typeof wordText !== 'string' || wordText.trim().length === 0) return invalid();

      const wordBegin = readTime(field(word, 'begin_time'));
      const wordEnd = readTime(field(word, 'end_time'));
      if (wordBegin.kind === 'missing' || wordEnd.kind === 'missing') return timingUnavailable();
      if (wordBegin.kind !== 'value' || wordEnd.kind !== 'value') return invalid();
      if (wordBegin.ms < begin.ms || wordEnd.ms > end.ms || wordBegin.ms >= wordEnd.ms) {
        return invalid();
      }

      const punctuation = field(word, 'punctuation');
      if (punctuation !== undefined && punctuation !== null && typeof punctuation !== 'string') {
        return invalid();
      }

      units.push({
        text: wordText,
        granularity: granularityFor(wordText),
        timing: availableTiming(wordBegin.ms, wordEnd.ms),
      });
    }

    const segmentId = `seg-${index}`;
    segments.push({
      segment_id: segmentId,
      text: sentenceText,
      timing: availableTiming(begin.ms, end.ms),
      units,
    });

    const emotion = field(sentence, 'emotion');
    if (emotion !== undefined && emotion !== null) {
      if (typeof emotion !== 'string') return invalid();
      if (emotion.length > 0) {
        observations.push({
          observation_id: `emotion-${labeledSentences}`,
          kind: 'emotion',
          label: emotion,
          timing: availableTiming(begin.ms, end.ms),
          source_provider: SOURCE_PROVIDER,
          source_model: FILETRANS_MODEL,
          segment_ids: [segmentId],
        });
        labeledSentences += 1;
      }
    }
  }

  const capabilities: Capabilities = {
    word_timing: okCapability(),
    emotion:
      labeledSentences > 0
        ? okCapability()
        : { status: 'unavailable', reason: EMOTION_UNAVAILABLE_REASON },
    prosody: { status: 'unavailable', reason: PROSODY_UNAVAILABLE_REASON },
    sound_event: { status: 'unavailable', reason: SOUND_EVENT_UNAVAILABLE_REASON },
  };

  return finalize(
    {
      schema_version: '0.1',
      asset_id: audio.asset_id,
      transcript: transcriptText,
      segments,
      observations,
      capabilities,
    },
    audio,
  );
}
