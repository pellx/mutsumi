/**
 * M02/D21 - map one stateless Gemini structured-audio result JSON string into
 * provider-independent AnnotatedAudio. Google payloads stay inside this adapter;
 * only the domain annotation shape leaves it. Timing is a model estimate with
 * explicit provenance, never forced alignment or a measured/averaged value: a
 * spoken unit without usable positive bounds makes the whole spoken result
 * `timing_unavailable`, and unsafe/reversed/out-of-clip bounds are `invalid_result`.
 * Runs unchanged under Node's built-in type stripping (erasable TypeScript only).
 */

import { validateAnnotatedAudio, validateAudioAsset } from '../../domain/annotation.ts';
import type {
  AnnotatedAudio,
  AudioAsset,
  Capabilities,
  Observation,
  TimedUnit,
  Timing,
  TimingGranularity,
  TranscriptSegment,
} from '../../domain/annotation.ts';
import type { AnalysisFailure } from '../../application/analysis-ports.js';

export const GEMINI_AUDIO_MODEL = 'gemini-3.8-flash';
export const GEMINI_TIMING_SOURCE =
  'google/gemini-3.8-flash/model-estimate-not-forced-alignment';

const SOURCE_PROVIDER = 'google';
const ENVELOPE_SOURCE = `${GEMINI_TIMING_SOURCE}/derived-segment-envelope`;

const MAX_JSON_CODE_UNITS = 1048576;
const MAX_TRANSCRIPT_CODE_UNITS = 65536;
const MAX_SEGMENTS = 256;
const MAX_TOTAL_UNITS = 4096;
const MAX_EMOTION_CODE_UNITS = 128;

const INVALID_AUDIO_MESSAGE = 'audio asset is not a valid transcription input';
const INVALID_RESULT_MESSAGE = 'provider result is not a valid structured audio payload for this model';
const TIMING_UNAVAILABLE_MESSAGE = 'provider result is missing usable model-estimated timing for spoken text';
const SILENT_WORD_TIMING_REASON = 'the transcribed clip is silent so no word or character timing is available';
const EMOTION_UNAVAILABLE_REASON = 'the model returned no audio candidate emotion label for the transcribed speech';
const PROSODY_UNAVAILABLE_REASON = 'prosody detection is not assessed by the gemini structured-audio prompt or schema';
const SOUND_EVENT_UNAVAILABLE_REASON = 'sound-event detection is not assessed by the gemini structured-audio prompt or schema';

const ROOT_KEYS = ['transcript', 'segments'];
const SEGMENT_KEYS = ['text', 'units', 'emotion'];
const UNIT_KEYS_REQUIRED = ['text', 'granularity'];
const UNIT_KEYS_ALLOWED = ['text', 'granularity', 'start_ms', 'end_ms'];

/** Output shape only; describes model estimates, not Gemini private vocabulary ids. */
export const GEMINI_AUDIO_SCHEMA: Readonly<Record<string, unknown>> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'GeminiStructuredAudioResult',
  type: 'object',
  additionalProperties: false,
  required: ['transcript', 'segments'],
  properties: {
    transcript: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'units', 'emotion'],
        properties: {
          text: { type: 'string' },
          emotion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          units: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'granularity', 'start_ms', 'end_ms'],
              properties: {
                text: { type: 'string' },
                granularity: { enum: ['word', 'character'] },
                start_ms: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                end_ms: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              },
            },
          },
        },
      },
    },
  },
};

type Failure = { ok: false; error: AnalysisFailure };
type Mapped = { ok: true; value: AnnotatedAudio } | Failure;
type PlainRecord = Record<string, unknown>;
type TimeCell = { k: 'v'; ms: number } | { k: 'u' } | { k: 'b' };
type UnitResult =
  | { s: 'valid'; start_ms: number; end_ms: number }
  | { s: 'soft' }
  | { s: 'hard' };
type StoredUnit = { text: string; granularity: TimingGranularity; start_ms: number; end_ms: number };
type StoredSegment = { text: string; emotion: string | null; units: StoredUnit[] };

function failure(code: AnalysisFailure['code'], message: string): Failure {
  return { ok: false, error: { code, stage: 'transcription', message, retryable: false } };
}
const invalidAudio = (): Failure => failure('invalid_audio', INVALID_AUDIO_MESSAGE);
const invalidResult = (): Failure => failure('invalid_result', INVALID_RESULT_MESSAGE);
const timingUnavailable = (): Failure => failure('timing_unavailable', TIMING_UNAVAILABLE_MESSAGE);

function normalize(text: string): string {
  return text.normalize('NFC').replace(/[\p{P}\p{White_Space}]/gu, '');
}
function codePoints(text: string): number {
  return Array.from(text).length;
}

function readRecord(value: unknown): PlainRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || d.get !== undefined || d.set !== undefined) return null;
  }
  return value as PlainRecord;
}
function readArray(value: unknown, max: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  if (!Number.isSafeInteger(value.length) || value.length < 0 || value.length > max) return null;
  for (let i = 0; i < value.length; i += 1) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (d === undefined || !d.enumerable || d.get !== undefined || d.set !== undefined) return null;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length' || /^(?:0|[1-9][0-9]*)$/.test(key)) continue;
    return null;
  }
  return value as unknown[];
}
function exactKeys(record: PlainRecord, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length) return false;
  for (const key of keys) if (!allowed.includes(key)) return false;
  return true;
}
function allowedKeysWithRequired(record: PlainRecord, required: readonly string[], allowed: readonly string[]): boolean {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return false;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  }
  return true;
}
function readCell(value: unknown): TimeCell {
  if (value === null || value === undefined) return { k: 'u' };
  if (typeof value === 'number' && Number.isSafeInteger(value)) return { k: 'v', ms: value };
  return { k: 'b' };
}
function unitTiming(start: unknown, end: unknown, duration: number): UnitResult {
  const a = readCell(start);
  const b = readCell(end);
  if (a.k === 'b' || b.k === 'b') return { s: 'hard' };
  if (a.k === 'v' && (a.ms < 0 || a.ms > duration)) return { s: 'hard' };
  if (b.k === 'v' && (b.ms < 0 || b.ms > duration)) return { s: 'hard' };
  if (a.k !== 'v' || b.k !== 'v') return { s: 'soft' };
  const startMs = a.ms;
  const endMs = b.ms;
  if (startMs > endMs) return { s: 'hard' };
  if (startMs === endMs) return { s: 'soft' };
  return { s: 'valid', start_ms: startMs, end_ms: endMs };
}

function available(start: number, end: number, source: string): Timing {
  return { status: 'available', start_ms: start, end_ms: end, source };
}
function okCapability(): Capabilities['emotion'] {
  return { status: 'ok', source_provider: SOURCE_PROVIDER, source_model: GEMINI_AUDIO_MODEL };
}
function unavailable(reason: string): Capabilities['emotion'] {
  return { status: 'unavailable', reason };
}
function finalize(document: AnnotatedAudio, asset: AudioAsset): Mapped {
  const validated = validateAnnotatedAudio(document, asset);
  if (!validated.ok) return invalidResult();
  return { ok: true, value: validated.value };
}

export function mapGeminiAudioResult(json: string, asset: AudioAsset): Mapped {
  const validatedAsset = validateAudioAsset(asset);
  if (!validatedAsset.ok) return invalidAudio();
  const audio = validatedAsset.value;

  if (typeof json !== 'string') return invalidResult();
  if (json.length > MAX_JSON_CODE_UNITS) return invalidResult();
  if (new TextEncoder().encode(json).byteLength > MAX_JSON_CODE_UNITS) return invalidResult();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalidResult();
  }

  const root = readRecord(parsed);
  if (root === null || !exactKeys(root, ROOT_KEYS)) return invalidResult();
  const transcript = root['transcript'];
  if (typeof transcript !== 'string') return invalidResult();
  if (transcript.length > MAX_TRANSCRIPT_CODE_UNITS) return invalidResult();
  const segments = readArray(root['segments'], MAX_SEGMENTS);
  if (segments === null) return invalidResult();

  if (transcript.length === 0) {
    if (segments.length !== 0) return invalidResult();
    return finalize(
      {
        schema_version: '0.1',
        asset_id: audio.asset_id,
        transcript: '',
        segments: [],
        observations: [],
        capabilities: {
          word_timing: unavailable(SILENT_WORD_TIMING_REASON),
          emotion: unavailable(EMOTION_UNAVAILABLE_REASON),
          prosody: unavailable(PROSODY_UNAVAILABLE_REASON),
          sound_event: unavailable(SOUND_EVENT_UNAVAILABLE_REASON),
        },
      },
      audio,
    );
  }

  const normalizedTranscript = normalize(transcript);
  if (normalizedTranscript.length === 0) return invalidResult();
  if (segments.length === 0) return invalidResult();

  const stored: StoredSegment[] = [];
  let totalUnits = 0;
  let concatenation = '';
  let lastStart = -1;
  let softMissing = false;

  for (const rawSegment of segments) {
    const seg = readRecord(rawSegment);
    if (seg === null || !exactKeys(seg, SEGMENT_KEYS)) return invalidResult();
    const segText = seg['text'];
    if (typeof segText !== 'string') return invalidResult();
    const unitArray = readArray(seg['units'], MAX_TOTAL_UNITS);
    if (unitArray === null || unitArray.length === 0) return invalidResult();
    const rawEmotion = seg['emotion'];
    let emotion: string | null = null;
    if (rawEmotion !== null) {
      if (typeof rawEmotion !== 'string' || rawEmotion.trim().length === 0 || rawEmotion.length > MAX_EMOTION_CODE_UNITS) {
        return invalidResult();
      }
      emotion = rawEmotion;
    }

    const storedUnits: StoredUnit[] = [];
    let segmentLex = '';
    for (const rawUnit of unitArray) {
      const unit = readRecord(rawUnit);
      if (unit === null || !allowedKeysWithRequired(unit, UNIT_KEYS_REQUIRED, UNIT_KEYS_ALLOWED)) return invalidResult();
      const unitText = unit['text'];
      if (typeof unitText !== 'string' || unitText.length === 0) return invalidResult();
      const granularity = unit['granularity'];
      if (granularity !== 'word' && granularity !== 'character') return invalidResult();
      if (granularity === 'character' && codePoints(unitText) !== 1) return invalidResult();
      const normalizedUnit = normalize(unitText);
      if (normalizedUnit.length === 0) return invalidResult();
      segmentLex += normalizedUnit;
      totalUnits += 1;
      if (totalUnits > MAX_TOTAL_UNITS) return invalidResult();

      const timing = unitTiming(unit['start_ms'], unit['end_ms'], audio.duration_ms);
      if (timing.s === 'hard') return invalidResult();
      if (timing.s === 'soft') {
        softMissing = true;
        continue;
      }
      if (timing.start_ms < lastStart) return invalidResult();
      lastStart = timing.start_ms;
      storedUnits.push({ text: unitText, granularity, start_ms: timing.start_ms, end_ms: timing.end_ms });
    }

    if (normalize(segText) !== segmentLex) return invalidResult();
    concatenation += segmentLex;
    stored.push({ text: segText, emotion, units: storedUnits });
  }

  if (concatenation !== normalizedTranscript) return invalidResult();
  if (softMissing) return timingUnavailable();

  const outSegments: TranscriptSegment[] = [];
  const observations: Observation[] = [];
  let observed = 0;
  for (let index = 0; index < stored.length; index += 1) {
    const segment = stored[index];
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = 0;
    const units: TimedUnit[] = [];
    for (const unit of segment.units) {
      if (unit.start_ms < minStart) minStart = unit.start_ms;
      if (unit.end_ms > maxEnd) maxEnd = unit.end_ms;
      units.push({
        text: unit.text,
        granularity: unit.granularity,
        timing: available(unit.start_ms, unit.end_ms, GEMINI_TIMING_SOURCE),
      });
    }
    const segmentId = `gemini-segment-${index}`;
    outSegments.push({
      segment_id: segmentId,
      text: segment.text,
      timing: available(minStart, maxEnd, ENVELOPE_SOURCE),
      units,
    });
    if (segment.emotion !== null) {
      observations.push({
        observation_id: `gemini-emotion-${observed}`,
        kind: 'emotion',
        label: segment.emotion,
        timing: available(minStart, maxEnd, GEMINI_TIMING_SOURCE),
        source_provider: SOURCE_PROVIDER,
        source_model: GEMINI_AUDIO_MODEL,
        segment_ids: [segmentId],
      });
      observed += 1;
    }
  }

  return finalize(
    {
      schema_version: '0.1',
      asset_id: audio.asset_id,
      transcript,
      segments: outSegments,
      observations,
      capabilities: {
        word_timing: okCapability(),
        emotion: observed > 0 ? okCapability() : unavailable(EMOTION_UNAVAILABLE_REASON),
        prosody: unavailable(PROSODY_UNAVAILABLE_REASON),
        sound_event: unavailable(SOUND_EVENT_UNAVAILABLE_REASON),
      },
    },
    audio,
  );
}
