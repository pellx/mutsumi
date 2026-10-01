/**
 * M02b/D20 - map Alibaba ASR file-transcription result JSON into AnnotatedAudio.
 *
 * Contract sources: docs/aliyun-asr-integration.md and docs/tasks/M02-filetrans-mapper.md.
 * Only the downloaded transcription payload is mapped here; submission, polling and
 * download stay transport concerns, and no vendor SDK type crosses this boundary.
 *
 * The qwen3-asr-flash-filetrans native path (`mapFiletransResult`) and the
 * Paraformer timing-calibration path (`mapParaformerResult`) share ONE strict
 * parser (`scanTranscriptPayload`) so the two models never diverge on validation
 * rules. `inspectFiletransResult` runs the same full-payload scan and reports
 * whether the only defects are timing-eligibility defects (missing/empty word
 * arrays, missing word times, or equal otherwise-valid word boundaries), which the
 * transport may resolve with a single calibration pass (D20).
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
export const PARAFORMER_MODEL = 'paraformer-v2';

const SOURCE_PROVIDER = 'aliyun';
const TIMING_SOURCE = `aliyun:${FILETRANS_MODEL}`;
const PARAFORMER_TIMING_SOURCE = `aliyun:${PARAFORMER_MODEL}:timestamp_alignment`;
const MAX_TRANSCRIPTS = 1;
const MAX_SENTENCES = 10000;
const MAX_WORDS = 100000;

const INVALID_AUDIO_MESSAGE = 'audio asset is not a valid transcription input';
const INVALID_RESULT_MESSAGE = 'provider result is not a valid transcription payload for this model';
const PARAFORMER_INVALID_MESSAGE = 'provider result is not a valid timing-calibration payload for this model';
const TIMING_UNAVAILABLE_MESSAGE = 'provider result is missing measured word timing for spoken text';
const INVALID_ANNOTATION_MESSAGE = 'mapped transcription result is not valid annotated audio';
const EMOTION_UNAVAILABLE_REASON = 'provider returned no sentence emotion label for the transcribed speech';
const PROSODY_UNAVAILABLE_REASON = `prosody detection is not supported by ${FILETRANS_MODEL}`;
const SOUND_EVENT_UNAVAILABLE_REASON = `sound-event detection is not supported by ${FILETRANS_MODEL}`;
const PARAFORMER_PROSODY_UNAVAILABLE_REASON = `prosody detection is not supported by ${PARAFORMER_MODEL}`;
const PARAFORMER_SOUND_EVENT_UNAVAILABLE_REASON = `sound-event detection is not supported by ${PARAFORMER_MODEL}`;
const PARAFORMER_EMOTION_UNAVAILABLE_REASON = `${PARAFORMER_MODEL} is a timing-calibration model and provides no emotion labels`;

type PlainRecord = Record<string, unknown>;
type TimeRead = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'value'; ms: number };
type Failure = { ok: false; error: AnalysisFailure };
type Mapped = { ok: true; value: AnnotatedAudio } | Failure;

/** One shared classification of a payload defect. */
type IssueKind = 'hard' | 'missing_timing' | 'zero_length';

type ParsedUnit = {
  text: string;
  granularity: TimingGranularity;
  beginMs: number | null;
  endMs: number | null;
};

type ParsedSentence = {
  sentenceText: string;
  beginMs: number;
  endMs: number;
  units: ParsedUnit[];
  emotionLabel: string | null;
};

/** Result of a FULL strict scan. `sentences` is complete only when `issues` is empty. */
type ScanOutcome = {
  issues: IssueKind[];
  transcriptText: string;
  silence: boolean;
  sentences: ParsedSentence[];
};

/** Per-model provenance/consumption policy layered on top of the shared parser. */
type ModelPolicy = {
  readonly model: string;
  readonly timingSource: string;
  readonly emotionMode: 'qwen' | 'paraformer';
  readonly prosodyReason: string;
  readonly soundEventReason: string;
  readonly emotionUnavailableReason: string;
};

const QWEN_POLICY: ModelPolicy = {
  model: FILETRANS_MODEL,
  timingSource: TIMING_SOURCE,
  emotionMode: 'qwen',
  prosodyReason: PROSODY_UNAVAILABLE_REASON,
  soundEventReason: SOUND_EVENT_UNAVAILABLE_REASON,
  emotionUnavailableReason: EMOTION_UNAVAILABLE_REASON,
};

const PARAFORMER_POLICY: ModelPolicy = {
  model: PARAFORMER_MODEL,
  timingSource: PARAFORMER_TIMING_SOURCE,
  emotionMode: 'paraformer',
  prosodyReason: PARAFORMER_PROSODY_UNAVAILABLE_REASON,
  soundEventReason: PARAFORMER_SOUND_EVENT_UNAVAILABLE_REASON,
  emotionUnavailableReason: PARAFORMER_EMOTION_UNAVAILABLE_REASON,
};

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

const invalidAudio = (): Failure => failure('invalid_audio', INVALID_AUDIO_MESSAGE);
const invalidResult = (): Failure => failure('invalid_result', INVALID_RESULT_MESSAGE);
const timingUnavailable = (): Failure => failure('timing_unavailable', TIMING_UNAVAILABLE_MESSAGE);

function okCapability(model: string): { status: 'ok'; source_provider: string; source_model: string } {
  return { status: 'ok', source_provider: SOURCE_PROVIDER, source_model: model };
}

function availableTiming(
  startMs: number,
  endMs: number,
  source: string,
): { status: 'available'; start_ms: number; end_ms: number; source: string } {
  return { status: 'available', start_ms: startMs, end_ms: endMs, source };
}

function finalize(document: AnnotatedAudio, asset: AudioAsset): Mapped {
  const validated = validateAnnotatedAudio(document, asset);
  if (!validated.ok) return invalidResult();
  return { ok: true, value: validated.value };
}

/**
 * The single strict parser shared by both models. It NEVER throws, NEVER mutates
 * the input and NEVER invokes an accessor (accessor-bearing records/arrays are
 * rejected by `readRecord`/`readArray` before any field read). It scans the whole
 * payload, recording every defect in traversal order so callers can both
 * short-circuit faithfully (native mapper) and inspect eligibility globally.
 */
function scanTranscriptPayload(raw: unknown, audio: AudioAsset): ScanOutcome {
  const issues: IssueKind[] = [];
  const sentences: ParsedSentence[] = [];
  const hardStop = (): ScanOutcome => {
    issues.push('hard');
    return { issues, transcriptText: '', silence: false, sentences };
  };

  const root = readRecord(raw);
  if (root === null) return hardStop();

  const transcripts = readArray(field(root, 'transcripts'), MAX_TRANSCRIPTS);
  if (transcripts === null || transcripts.length !== MAX_TRANSCRIPTS) return hardStop();

  const transcript = readRecord(transcripts[0]);
  if (transcript === null) return hardStop();

  if (field(transcript, 'channel_id') !== 0) return hardStop();

  const transcriptText = field(transcript, 'text');
  if (typeof transcriptText !== 'string') return hardStop();

  const sentencesValue = readArray(field(transcript, 'sentences'), MAX_SENTENCES);
  if (sentencesValue === null) return hardStop();

  if (transcriptText.length === 0) {
    if (sentencesValue.length > 0) return hardStop();
    return { issues, transcriptText: '', silence: true, sentences };
  }
  if (transcriptText.trim().length === 0) return hardStop();
  if (sentencesValue.length === 0) return hardStop();

  let totalWords = 0;
  let stopScanning = false;
  for (let index = 0; index < sentencesValue.length; index += 1) {
    const sentence = readRecord(sentencesValue[index]);
    if (sentence === null) {
      issues.push('hard');
      continue;
    }

    const sentenceText = field(sentence, 'text');
    if (typeof sentenceText !== 'string' || sentenceText.trim().length === 0) {
      issues.push('hard');
      continue;
    }

    const begin = readTime(field(sentence, 'begin_time'));
    const end = readTime(field(sentence, 'end_time'));
    if (begin.kind !== 'value' || end.kind !== 'value') {
      issues.push('hard');
      continue;
    }
    if (begin.ms < 0 || end.ms > audio.duration_ms || begin.ms >= end.ms) {
      issues.push('hard');
      continue;
    }

    const units: ParsedUnit[] = [];
    const wordsValue = field(sentence, 'words');
    let wordsSkipped = false;
    if (wordsValue === undefined || wordsValue === null) {
      issues.push('missing_timing');
      wordsSkipped = true;
    }
    if (!wordsSkipped) {
      const wordsArr = readArray(wordsValue, MAX_WORDS);
      if (wordsArr === null) {
        issues.push('hard');
        wordsSkipped = true;
      } else if (wordsArr.length === 0) {
        issues.push('missing_timing');
        wordsSkipped = true;
      } else {
        totalWords += wordsArr.length;
        if (totalWords > MAX_WORDS) {
          issues.push('hard');
          wordsSkipped = true;
          stopScanning = true;
        } else {
          for (const rawWord of wordsArr) {
            const word = readRecord(rawWord);
            if (word === null) {
              issues.push('hard');
              continue;
            }

            const wordText = field(word, 'text');
            if (typeof wordText !== 'string' || wordText.trim().length === 0) {
              issues.push('hard');
              continue;
            }

            const wordBegin = readTime(field(word, 'begin_time'));
            const wordEnd = readTime(field(word, 'end_time'));
            let resolvedBegin: number | null = null;
            let resolvedEnd: number | null = null;

            if (wordBegin.kind === 'invalid' || wordEnd.kind === 'invalid') {
              issues.push('hard');
            } else {
              if (wordBegin.kind === 'value') resolvedBegin = wordBegin.ms;
              if (wordEnd.kind === 'value') resolvedEnd = wordEnd.ms;

              const beginOut = resolvedBegin !== null && (resolvedBegin < 0 || resolvedBegin < begin.ms || resolvedBegin > end.ms);
              const endOut = resolvedEnd !== null && (resolvedEnd < 0 || resolvedEnd > end.ms || resolvedEnd < begin.ms);
              if (beginOut || endOut) {
                issues.push('hard');
              } else if (resolvedBegin !== null && resolvedEnd !== null) {
                if (resolvedBegin > resolvedEnd) {
                  issues.push('hard');
                } else if (resolvedBegin === resolvedEnd) {
                  issues.push('zero_length');
                }
              } else {
                issues.push('missing_timing');
              }
            }

            const punctuation = field(word, 'punctuation');
            if (punctuation !== undefined && punctuation !== null && typeof punctuation !== 'string') {
              issues.push('hard');
            }

            units.push({
              text: wordText,
              granularity: granularityFor(wordText),
              beginMs: resolvedBegin,
              endMs: resolvedEnd,
            });
          }
        }
      }
    }

    let emotionLabel: string | null = null;
    const emotion = field(sentence, 'emotion');
    if (emotion !== undefined && emotion !== null) {
      if (typeof emotion !== 'string') {
        issues.push('hard');
      } else if (emotion.length > 0) {
        emotionLabel = emotion;
      }
    }

    sentences.push({ sentenceText, beginMs: begin.ms, endMs: end.ms, units, emotionLabel });
    if (stopScanning) break;
  }

  return { issues, transcriptText, silence: false, sentences };
}

/**
 * Assemble a validated AnnotatedAudio from a defect-free scan under a model
 * policy. Native qwen emotion labels and their sentence timings are preserved
 * verbatim (no invented score); the Paraformer policy reports emotion/prosody/
 * sound-event unavailable and ignores unexpected emotion fields.
 */
function buildAnnotation(outcome: ScanOutcome, audio: AudioAsset, policy: ModelPolicy): Mapped {
  const segments: TranscriptSegment[] = [];
  const observations: Observation[] = [];
  let labeled = 0;

  for (let index = 0; index < outcome.sentences.length; index += 1) {
    const sentence = outcome.sentences[index];
    const units: TimedUnit[] = [];
    for (const unit of sentence.units) {
      if (unit.beginMs === null || unit.endMs === null) {
        return invalidResult();
      }
      units.push({
        text: unit.text,
        granularity: unit.granularity,
        timing: availableTiming(unit.beginMs, unit.endMs, policy.timingSource),
      });
    }
    const segmentId = `seg-${index}`;
    segments.push({
      segment_id: segmentId,
      text: sentence.sentenceText,
      timing: availableTiming(sentence.beginMs, sentence.endMs, policy.timingSource),
      units,
    });

    if (policy.emotionMode === 'qwen' && sentence.emotionLabel !== null && sentence.emotionLabel.length > 0) {
      observations.push({
        observation_id: `emotion-${labeled}`,
        kind: 'emotion',
        label: sentence.emotionLabel,
        timing: availableTiming(sentence.beginMs, sentence.endMs, policy.timingSource),
        source_provider: SOURCE_PROVIDER,
        source_model: policy.model,
        segment_ids: [segmentId],
      });
      labeled += 1;
    }
  }

  const capabilities: Capabilities = {
    word_timing: okCapability(policy.model),
    emotion:
      policy.emotionMode === 'paraformer' || (!outcome.silence && labeled === 0)
        ? { status: 'unavailable', reason: policy.emotionUnavailableReason }
        : okCapability(policy.model),
    prosody: { status: 'unavailable', reason: policy.prosodyReason },
    sound_event: { status: 'unavailable', reason: policy.soundEventReason },
  };

  return finalize(
    {
      schema_version: '0.1',
      asset_id: audio.asset_id,
      transcript: outcome.silence ? '' : outcome.transcriptText,
      segments: outcome.silence ? [] : segments,
      observations: outcome.silence ? [] : observations,
      capabilities,
    },
    audio,
  );
}

/**
 * Lexical normalization used ONLY for timing-fusion coverage checks: NFC, then
 * remove Unicode punctuation and whitespace. No case folding, no substitution.
 * Lengths and offsets are always measured in Unicode code points.
 */
function lexicalNormalize(text: string): string {
  return text.normalize('NFC').replace(/[\p{P}\p{White_Space}]/gu, '');
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Qwen-only lexical pre-flight shared by eligibility inspection and fusion. It
 * re-derives text purely from the parsed payload (no mutation, no accessors).
 * Before a calibration would be billed, Qwen must already be internally coherent:
 * every sentence carries nonempty lexical content, any present word units cover
 * their own sentence exactly, and the full transcript equals the concatenated
 * sentence content (all after lexical normalization). A fully valid native
 * payload never reaches this check, so native mapping behavior is unchanged.
 */
function qwenLexicalConsistencyForFusion(outcome: ScanOutcome): boolean {
  if (outcome.silence || outcome.sentences.length === 0) return false;
  let concatLex = '';
  for (const sentence of outcome.sentences) {
    const sentenceLex = lexicalNormalize(sentence.sentenceText);
    if (sentenceLex.length === 0) return false;
    if (sentence.units.length > 0) {
      let unitsLex = '';
      for (const unit of sentence.units) unitsLex += lexicalNormalize(unit.text);
      if (unitsLex !== sentenceLex) return false;
    }
    concatLex += sentenceLex;
  }
  return concatLex === lexicalNormalize(outcome.transcriptText);
}

/**
 * Pure D20 timing fusion. Qwen text, punctuation, sentence emotion, references
 * and stable ids stay primary; only word/segment timing is replaced by the
 * Paraformer calibration, and only when that calibration is a valid annotation
 * for the same asset, is stamped aliyun paraformer-v2 timestamp alignment, has
 * every unit available/positive/ordered/non-overlapping within the clip, and
 * covers the complete normalized Qwen lexical sequence with sentence and word
 * boundaries landing exactly on calibrated unit boundaries (a Qwen single
 * character is never split out of a multi-character calibrated unit, and no
 * separate character times are invented). Output units are the actual calibrated
 * units (text/granularity/timing copied verbatim). A Qwen sentence envelope is
 * derived from its first/last actual unit and records that derivation. Any
 * deviation is a safe `invalid_result`; neither input is mutated, no accessor is
 * executed, and the mandatory final domain validation never yields a partial
 * annotation. No external observations are merged.
 */
function fuseWithCalibration(
  outcome: ScanOutcome,
  audio: AudioAsset,
  calibration: AnnotatedAudio,
): Mapped {
  const validatedCal = validateAnnotatedAudio(calibration, audio);
  if (!validatedCal.ok) return invalidResult();
  const cal = validatedCal.value;
  if (cal.asset_id !== audio.asset_id) return invalidResult();

  const calWordTiming = cal.capabilities.word_timing;
  if (
    calWordTiming.status !== 'ok' ||
    calWordTiming.source_provider !== SOURCE_PROVIDER ||
    calWordTiming.source_model !== PARAFORMER_MODEL
  ) {
    return invalidResult();
  }

  const unitText: string[] = [];
  const unitGranularity: TimingGranularity[] = [];
  const unitStart: number[] = [];
  const unitEnd: number[] = [];
  const unitLex: string[] = [];
  const unitStartOffsets: number[] = [];
  let runningLexOffset = 0;
  let previousEnd = -1;
  for (const segment of cal.segments) {
    let covered = '';
    for (const unit of segment.units) {
      if (unit.timing.status !== 'available') return invalidResult();
      if (unit.timing.source !== PARAFORMER_TIMING_SOURCE) return invalidResult();
      const startMs = unit.timing.start_ms;
      const endMs = unit.timing.end_ms;
      if (startMs < 0 || endMs <= startMs || endMs > audio.duration_ms) return invalidResult();
      if (startMs < previousEnd) return invalidResult();
      const lex = lexicalNormalize(unit.text);
      if (lex.length === 0) return invalidResult();
      previousEnd = endMs;
      unitStartOffsets.push(runningLexOffset);
      runningLexOffset += codePointLength(lex);
      unitText.push(unit.text);
      unitGranularity.push(unit.granularity);
      unitStart.push(startMs);
      unitEnd.push(endMs);
      unitLex.push(lex);
      covered += lex;
    }
    if (covered !== lexicalNormalize(segment.text)) return invalidResult();
  }
  if (unitStart.length === 0) return invalidResult();

  let calUnitsLex = '';
  for (const lex of unitLex) calUnitsLex += lex;
  let calSegmentsLex = '';
  for (const segment of cal.segments) calSegmentsLex += lexicalNormalize(segment.text);
  if (calSegmentsLex !== lexicalNormalize(cal.transcript) || calUnitsLex !== calSegmentsLex) {
    return invalidResult();
  }

  if (!qwenLexicalConsistencyForFusion(outcome)) return invalidResult();
  const qwenFullLex = lexicalNormalize(outcome.transcriptText);
  if (qwenFullLex.length === 0 || qwenFullLex !== calUnitsLex) return invalidResult();

  const boundaries = new Set<number>();
  for (let i = 0; i <= unitStartOffsets.length; i += 1) {
    boundaries.add(i === unitStartOffsets.length ? runningLexOffset : unitStartOffsets[i]);
  }

  const envelopeSource = `${PARAFORMER_TIMING_SOURCE}:unit-envelope`;
  const segments: TranscriptSegment[] = [];
  const observations: Observation[] = [];
  let qwenLexCursor = 0;
  let unitCursor = 0;
  let labeled = 0;

  for (let index = 0; index < outcome.sentences.length; index += 1) {
    const sentence = outcome.sentences[index];
    const sentenceLex = lexicalNormalize(sentence.sentenceText);
    const startOffset = qwenLexCursor;
    const endOffset = startOffset + codePointLength(sentenceLex);
    if (!boundaries.has(startOffset) || !boundaries.has(endOffset)) return invalidResult();

    if (sentence.units.length > 0) {
      let wordCursor = startOffset;
      for (const word of sentence.units) {
        wordCursor += codePointLength(lexicalNormalize(word.text));
        if (!boundaries.has(wordCursor)) return invalidResult();
      }
      if (wordCursor !== endOffset) return invalidResult();
    }

    const firstUnit = unitCursor;
    const units: TimedUnit[] = [];
    while (unitCursor < unitStart.length && unitStartOffsets[unitCursor] < endOffset) {
      units.push({
        text: unitText[unitCursor],
        granularity: unitGranularity[unitCursor],
        timing: availableTiming(unitStart[unitCursor], unitEnd[unitCursor], PARAFORMER_TIMING_SOURCE),
      });
      unitCursor += 1;
    }
    if (units.length === 0) return invalidResult();
    const lastUnit = unitCursor - 1;
    if (unitStartOffsets[lastUnit] + codePointLength(unitLex[lastUnit]) !== endOffset) return invalidResult();

    const segmentId = `seg-${index}`;
    segments.push({
      segment_id: segmentId,
      text: sentence.sentenceText,
      timing: availableTiming(unitStart[firstUnit], unitEnd[lastUnit], envelopeSource),
      units,
    });

    if (sentence.emotionLabel !== null && sentence.emotionLabel.length > 0) {
      observations.push({
        observation_id: `emotion-${labeled}`,
        kind: 'emotion',
        label: sentence.emotionLabel,
        timing: availableTiming(sentence.beginMs, sentence.endMs, TIMING_SOURCE),
        source_provider: SOURCE_PROVIDER,
        source_model: FILETRANS_MODEL,
        segment_ids: [segmentId],
      });
      labeled += 1;
    }
    qwenLexCursor = endOffset;
  }
  if (unitCursor !== unitStart.length) return invalidResult();

  const capabilities: Capabilities = {
    word_timing: okCapability(PARAFORMER_MODEL),
    emotion:
      labeled === 0
        ? { status: 'unavailable', reason: EMOTION_UNAVAILABLE_REASON }
        : okCapability(FILETRANS_MODEL),
    prosody: { status: 'unavailable', reason: PROSODY_UNAVAILABLE_REASON },
    sound_event: { status: 'unavailable', reason: SOUND_EVENT_UNAVAILABLE_REASON },
  };

  return finalize(
    {
      schema_version: '0.1',
      asset_id: audio.asset_id,
      transcript: outcome.transcriptText,
      segments,
      observations,
      capabilities,
    },
    audio,
  );
}

/**
 * Native qwen3-asr-flash-filetrans mapper, optionally fused with ONE Paraformer
 * timing calibration (D20). A fully valid native payload (speech or silence)
 * IGNORES `calibration`. With no calibration supplied the strict safe errors are
 * exactly the original traversal-order behavior (missing timing ->
 * `timing_unavailable`; malformed/out-of-bounds/zero-length/reversed word ->
 * `invalid_result`). With a calibration supplied, a payload whose ONLY defects
 * are soft (missing/zero-length word timing) is fused; any hard defect still
 * fails safe and never fuses, and fusion rejection is reported as `invalid_result`.
 */
export function mapFiletransResult(
  raw: unknown,
  asset: AudioAsset,
  calibration?: AnnotatedAudio,
): { ok: true; value: AnnotatedAudio } | { ok: false; error: AnalysisFailure } {
  const validatedAsset = validateAudioAsset(asset);
  if (!validatedAsset.ok) return invalidAudio();
  const audio = validatedAsset.value;

  const outcome = scanTranscriptPayload(raw, audio);
  if (outcome.issues.length > 0) {
    if (calibration === undefined || calibration === null) {
      return outcome.issues[0] === 'missing_timing' ? timingUnavailable() : invalidResult();
    }
    if (outcome.issues.includes('hard')) return invalidResult();
    if (!qwenLexicalConsistencyForFusion(outcome)) return invalidResult();
    return fuseWithCalibration(outcome, audio, calibration);
  }
  return buildAnnotation(outcome, audio, QWEN_POLICY);
}

/**
 * Paraformer-v2 timing-calibration mapper. It requires fully valid, strictly
 * positive word timing (a calibration source has no timing-optional semantics
 * and no secondary fallback), preserves provider granularity, stamps units,
 * segments and the word_timing capability with the Paraformer provenance, and
 * always reports emotion/prosody/sound-event unavailable even if unexpected
 * emotion fields appear in the payload.
 */
export function mapParaformerResult(
  raw: unknown,
  asset: AudioAsset,
): { ok: true; value: AnnotatedAudio } | { ok: false; error: AnalysisFailure } {
  const validatedAsset = validateAudioAsset(asset);
  if (!validatedAsset.ok) return invalidAudio();
  const audio = validatedAsset.value;

  const outcome = scanTranscriptPayload(raw, audio);
  if (outcome.issues.length > 0) {
    return failure('invalid_result', PARAFORMER_INVALID_MESSAGE);
  }
  return buildAnnotation(outcome, audio, PARAFORMER_POLICY);
}

/**
 * Whole-payload eligibility probe used by the transport. It returns the shared
 * failure shape when anything is structurally invalid, and otherwise reports
 * whether the ONLY defects are calibration-resolvable timing defects.
 *
 * `needs_calibration === true` means the payload is otherwise well-formed and the
 * sole defect is a missing/empty word array, a missing word time, or an
 * equal otherwise-valid word boundary (D20). A genuine defect (malformed field,
 * negative/non-integer/reversed/out-of-clip bound, missing/invalid sentence
 * bounds, malformed structure, or a second defect after a zero-length unit) is a
 * `hard` issue and NEVER qualifies. The transport still owns whether a calibration
 * port is configured; this function performs no fusion and reports no timing plan.
 */
export type FiletransInspection =
  | { ok: true; needs_calibration: boolean }
  | { ok: false; error: AnalysisFailure };

export function inspectFiletransResult(raw: unknown, asset: AudioAsset): FiletransInspection {
  const validatedAsset = validateAudioAsset(asset);
  if (!validatedAsset.ok) {
    return { ok: false, error: { code: 'invalid_audio', stage: 'transcription', message: INVALID_AUDIO_MESSAGE, retryable: false } };
  }
  const audio = validatedAsset.value;

  const outcome = scanTranscriptPayload(raw, audio);
  if (outcome.issues.includes('hard')) return invalidResult();
  if (outcome.issues.length > 0) {
    if (!qwenLexicalConsistencyForFusion(outcome)) return invalidResult();
    return { ok: true, needs_calibration: true };
  }
  return { ok: true, needs_calibration: false };
}