/**
 * M03 - conversation-boundary validators for provider-independent domain data.
 *
 * Contract source: docs/sleep-work-plan.md (M03), with record types from
 * ./conversation.ts and the accepted input-annotation validation in
 * ./annotation.ts.
 *
 * Shared conventions (mirroring M01):
 * - Validation never throws, never coerces, never mutates and never fabricates
 *   data. A successful result returns the original input value unchanged.
 * - Accepted records are plain objects (`Object.prototype` or null prototype)
 *   whose required fields are enumerable own data properties. Symbol keys,
 *   getters, setters and non-enumerable own properties are rejected before any
 *   field is read, so user accessors are never invoked. Frozen JSON is valid.
 * - Accepted arrays are ordinary dense own-data arrays; oversized arrays are
 *   rejected before iteration.
 * - Planned expression timing is not measured audio timing: generated output
 *   alignment must carry measured intervals inside the output asset and must
 *   lexically cover the reply text.
 * - Issue messages are static safe descriptions and never echo input values.
 *   Arbitrary adversarial Proxy objects are outside the guarantee.
 */

import type {
  AnnotatedAudio,
  AudioAsset,
  TimedUnit,
  ValidationIssue,
  ValidationResult,
} from './annotation.ts';
import { validateAnnotatedAudio, validateAudioAsset } from './annotation.ts';
import type {
  GeneratedSpeech,
  HistoryTurn,
  OwnerPreference,
  Persona,
  ReplyDraft,
  ReplyPlan,
} from './conversation.ts';

type DataRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Limits (characters, counts and milliseconds)
// ---------------------------------------------------------------------------

const MAX_PERSONA_ID_LENGTH = 128;
const MAX_PERSONA_NAME_LENGTH = 128;
const MAX_PERSONA_INSTRUCTIONS = 8;
const MAX_INSTRUCTION_LENGTH = 1000;
const MAX_PREFERENCES = 16;
const MAX_PREFERENCE_KEY_LENGTH = 64;
const MAX_PREFERENCE_VALUE_LENGTH = 500;
const MAX_HISTORY_TURNS = 100;
const MAX_TURN_ID_LENGTH = 128;
const MAX_USER_TEXT_LENGTH = 16_384;
const MAX_ASSISTANT_TEXT_LENGTH = 8_000;
const MAX_REPLY_ID_LENGTH = 128;
const MAX_REPLY_TEXT_LENGTH = 8_000;
const MAX_EXPRESSION_SEGMENTS = 64;
const MAX_SEGMENT_TEXT_LENGTH = 8_000;
const MAX_TONE_LENGTH = 64;
const MIN_EMOTION_INTENSITY = 0;
const MAX_EMOTION_INTENSITY = 1;
const MIN_PACE = 0.5;
const MAX_PACE = 2;
const MAX_PAUSE_AFTER_MS = 5_000;
const MAX_GENERATED_AUDIO_MS = 30_000;
const MAX_CONTROL_COUNT = 64;
const MAX_CONTROL_LENGTH = 128;
const MAX_ALIGNMENT_SOURCE_LENGTH = 256;
const MAX_ALIGNMENT_UNITS = 4_096;

// ---------------------------------------------------------------------------
// Exact field sets
// ---------------------------------------------------------------------------

const PERSONA_KEYS = ['persona_id', 'name', 'instructions'];
const PREFERENCE_KEYS = ['key', 'value'];
const HISTORY_TURN_KEYS = ['turn_id', 'user_text', 'assistant_text', 'assistant_playback_completed'];
const DRAFT_KEYS = ['reply_text', 'segments'];
const PLAN_KEYS = ['reply_id', 'segments'];
const SEGMENT_KEYS = ['text', 'tone', 'emotion_intensity', 'pace', 'pause_after_ms'];
const GENERATED_SPEECH_KEYS = [
  'asset',
  'storage_key',
  'alignment',
  'applied_controls',
  'unsupported_controls',
];
const ALIGNMENT_KEYS = ['units', 'source'];

const ALIGNMENT_UNITS_PATH = '$.alignment.units';
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PLANNED_TIME_SOURCE_PATTERN = /(?:^|[\/:_\s-])(?:plan(?:ned)?|intended|schedule(?:d)?)(?:$|[\/:_\s-])/i;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;

// ---------------------------------------------------------------------------
// Shape, string and number helpers
// ---------------------------------------------------------------------------

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function joinPath(base: string, key: string): string {
  return `${base}.${key}`;
}

function indexPath(base: string, index: number): string {
  return `${base}[${index}]`;
}

function isPlainRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Reject symbol keys, accessors and non-enumerable own properties before any read. */
function checkRecordShape(value: DataRecord, path: string, issues: ValidationIssue[]): boolean {
  let plain = true;
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    pushIssue(issues, path, 'symbol-keyed property is not part of the contract');
    plain = false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      continue;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      pushIssue(issues, joinPath(path, key), 'must be a plain data property, not a getter or setter');
      plain = false;
      continue;
    }
    if (!descriptor.enumerable) {
      pushIssue(issues, joinPath(path, key), 'must be an enumerable own property');
      plain = false;
    }
  }
  return plain;
}

/** `false` means the caller must not read any field of `input`. */
function requireDataRecord(
  input: unknown,
  path: string,
  label: string,
  issues: ValidationIssue[],
): input is DataRecord {
  if (!isPlainRecord(input)) {
    pushIssue(issues, path, `${label} must be a plain object`);
    return false;
  }
  return checkRecordShape(input, path, issues);
}

function checkExactKeys(
  value: DataRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      pushIssue(issues, joinPath(path, key), 'unknown field is not part of the M03 contract');
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      pushIssue(issues, joinPath(path, key), 'required field is missing');
    }
  }
}

function isArrayIndexKey(key: string): boolean {
  return ARRAY_INDEX_PATTERN.test(key) && Number(key) < 4294967295;
}

/** `false` means the caller must not iterate or read any element. */
function checkDenseArray(
  input: unknown,
  path: string,
  maxLength: number,
  label: string,
  issues: ValidationIssue[],
): input is unknown[] {
  if (!Array.isArray(input)) {
    pushIssue(issues, path, `${label} must be an array`);
    return false;
  }
  if (Object.getPrototypeOf(input) !== Array.prototype) {
    pushIssue(issues, path, `${label} must be an ordinary array`);
    return false;
  }
  if (input.length > maxLength) {
    pushIssue(issues, path, `${label} must contain at most ${maxLength} entries`);
    return false;
  }
  let dense = true;
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined) {
      pushIssue(issues, indexPath(path, index), 'array element is missing (sparse array)');
      dense = false;
      continue;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      pushIssue(issues, indexPath(path, index), 'array element must be a plain data property');
      dense = false;
      continue;
    }
    if (!descriptor.enumerable) {
      pushIssue(issues, indexPath(path, index), 'array element must be an enumerable own property');
      dense = false;
    }
  }
  for (const key of Object.getOwnPropertyNames(input)) {
    if (key === 'length' || isArrayIndexKey(key)) {
      continue;
    }
    pushIssue(issues, joinPath(path, key), 'non-index array property is not part of the contract');
    dense = false;
  }
  for (const symbol of Object.getOwnPropertySymbols(input)) {
    pushIssue(issues, path, 'symbol-keyed array property is not part of the contract');
    dense = false;
  }
  return dense;
}

/** Nonblank means at least one non-whitespace character; no trimming, no coercion. */
function checkFieldString(
  value: unknown,
  path: string,
  label: string,
  issues: ValidationIssue[],
  maxLength: number | null,
  allowBlank = false,
): value is string {
  if (typeof value !== 'string') {
    pushIssue(issues, path, `${label} must be a string`);
    return false;
  }
  if (allowBlank === false && /\S/.test(value) === false) {
    pushIssue(issues, path, `${label} must be a nonblank string`);
    return false;
  }
  if (maxLength !== null && value.length > maxLength) {
    pushIssue(issues, path, `${label} must be at most ${maxLength} characters`);
    return false;
  }
  return true;
}

function checkNumberInRange(
  value: unknown,
  path: string,
  label: string,
  min: number,
  max: number,
  issues: ValidationIssue[],
): boolean {
  if (typeof value !== 'number' || Number.isFinite(value) === false) {
    pushIssue(issues, path, `${label} must be a finite number`);
    return false;
  }
  if (value < min || value > max) {
    pushIssue(issues, path, `${label} must be between ${min} and ${max}`);
    return false;
  }
  return true;
}

function checkNullableNumberInRange(
  value: unknown,
  path: string,
  label: string,
  min: number,
  max: number,
  issues: ValidationIssue[],
): boolean {
  if (value === null) {
    return true;
  }
  return checkNumberInRange(value, path, label, min, max, issues);
}

function checkNullableSafeIntegerInRange(
  value: unknown,
  path: string,
  label: string,
  min: number,
  max: number,
  issues: ValidationIssue[],
): boolean {
  if (value === null) {
    return true;
  }
  if (Number.isSafeInteger(value) === false || (value as number) < min || (value as number) > max) {
    pushIssue(issues, path, `${label} must be an integer between ${min} and ${max}, or null`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Persona, preferences and history
// ---------------------------------------------------------------------------

/** Validate owner-authored persona configuration. Never quoted user speech. */
export function validatePersona(input: unknown): ValidationResult<Persona> {
  const issues: ValidationIssue[] = [];
  if (requireDataRecord(input, '$', 'persona', issues)) {
    checkExactKeys(input, PERSONA_KEYS, '$', issues);
    checkFieldString(input['persona_id'], '$.persona_id', 'persona_id', issues, MAX_PERSONA_ID_LENGTH);
    checkFieldString(input['name'], '$.name', 'name', issues, MAX_PERSONA_NAME_LENGTH);
    const instructions = input['instructions'];
    const instructionsPath = '$.instructions';
    if (
      checkDenseArray(instructions, instructionsPath, MAX_PERSONA_INSTRUCTIONS, 'instructions', issues)
    ) {
      instructions.forEach((instruction, index) => {
        checkFieldString(
          instruction,
          indexPath(instructionsPath, index),
          'instruction',
          issues,
          MAX_INSTRUCTION_LENGTH,
        );
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as Persona };
}

/** Validate explicit owner preferences only; never inferred facts. */
export function validatePreferences(input: unknown): ValidationResult<OwnerPreference[]> {
  const issues: ValidationIssue[] = [];
  if (checkDenseArray(input, '$', MAX_PREFERENCES, 'preferences', issues)) {
    const seenKeys = new Set<string>();
    input.forEach((entry, index) => {
      const entryPath = indexPath('$', index);
      if (!requireDataRecord(entry, entryPath, 'preference', issues)) {
        return;
      }
      checkExactKeys(entry, PREFERENCE_KEYS, entryPath, issues);
      const key = entry['key'];
      if (checkFieldString(key, joinPath(entryPath, 'key'), 'key', issues, MAX_PREFERENCE_KEY_LENGTH)) {
        if (seenKeys.has(key)) {
          pushIssue(issues, joinPath(entryPath, 'key'), 'preference keys must be unique');
        } else {
          seenKeys.add(key);
        }
      }
      checkFieldString(
        entry['value'],
        joinPath(entryPath, 'value'),
        'value',
        issues,
        MAX_PREFERENCE_VALUE_LENGTH,
      );
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as OwnerPreference[] };
}

/** Validate bounded prior turns; a null assistant reply was never played. */
export function validateHistoryTurns(input: unknown): ValidationResult<HistoryTurn[]> {
  const issues: ValidationIssue[] = [];
  if (checkDenseArray(input, '$', MAX_HISTORY_TURNS, 'history turns', issues)) {
    input.forEach((entry, index) => {
      const entryPath = indexPath('$', index);
      if (!requireDataRecord(entry, entryPath, 'history turn', issues)) {
        return;
      }
      checkExactKeys(entry, HISTORY_TURN_KEYS, entryPath, issues);
      checkFieldString(entry['turn_id'], joinPath(entryPath, 'turn_id'), 'turn_id', issues, MAX_TURN_ID_LENGTH);
      checkFieldString(
        entry['user_text'],
        joinPath(entryPath, 'user_text'),
        'user_text',
        issues,
        MAX_USER_TEXT_LENGTH,
        true,
      );
      const assistantText = entry['assistant_text'];
      if (assistantText !== null) {
        checkFieldString(
          assistantText,
          joinPath(entryPath, 'assistant_text'),
          'assistant_text',
          issues,
          MAX_ASSISTANT_TEXT_LENGTH,
        );
      }
      const playback = entry['assistant_playback_completed'];
      if (typeof playback !== 'boolean') {
        pushIssue(
          issues,
          joinPath(entryPath, 'assistant_playback_completed'),
          'assistant_playback_completed must be a boolean',
        );
      } else if (playback && assistantText === null) {
        pushIssue(
          issues,
          joinPath(entryPath, 'assistant_playback_completed'),
          'a turn without assistant_text cannot be marked as played',
        );
      }
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as HistoryTurn[] };
}

// ---------------------------------------------------------------------------
// Expression segments, reply draft and reply plan
// ---------------------------------------------------------------------------

type SegmentScan = { structureOk: boolean; texts: string[] };

function scanExpressionSegments(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): SegmentScan {
  const texts: string[] = [];
  if (!checkDenseArray(input, path, MAX_EXPRESSION_SEGMENTS, 'segments', issues)) {
    return { structureOk: false, texts };
  }
  if (input.length === 0) {
    pushIssue(issues, path, 'segments must contain at least 1 entry');
    return { structureOk: false, texts };
  }
  let structureOk = true;
  input.forEach((entry, index) => {
    const entryPath = indexPath(path, index);
    if (!requireDataRecord(entry, entryPath, 'expression segment', issues)) {
      structureOk = false;
      return;
    }
    checkExactKeys(entry, SEGMENT_KEYS, entryPath, issues);
    const text = entry['text'];
    const textOk = checkFieldString(
      text,
      joinPath(entryPath, 'text'),
      'segment text',
      issues,
      MAX_SEGMENT_TEXT_LENGTH,
    );
    checkFieldString(entry['tone'], joinPath(entryPath, 'tone'), 'tone', issues, MAX_TONE_LENGTH);
    const intensityOk = checkNumberInRange(
      entry['emotion_intensity'],
      joinPath(entryPath, 'emotion_intensity'),
      'emotion_intensity',
      MIN_EMOTION_INTENSITY,
      MAX_EMOTION_INTENSITY,
      issues,
    );
    const paceOk = checkNullableNumberInRange(
      entry['pace'],
      joinPath(entryPath, 'pace'),
      'pace',
      MIN_PACE,
      MAX_PACE,
      issues,
    );
    const pauseOk = checkNullableSafeIntegerInRange(
      entry['pause_after_ms'],
      joinPath(entryPath, 'pause_after_ms'),
      'pause_after_ms',
      0,
      MAX_PAUSE_AFTER_MS,
      issues,
    );
    if (textOk && intensityOk && paceOk && pauseOk) {
      texts.push(text);
    } else {
      structureOk = false;
    }
  });
  return { structureOk, texts };
}

/** Validate reply text with planned expression segments covering it exactly. */
export function validateReplyDraft(input: unknown): ValidationResult<ReplyDraft> {
  const issues: ValidationIssue[] = [];
  if (requireDataRecord(input, '$', 'reply draft', issues)) {
    checkExactKeys(input, DRAFT_KEYS, '$', issues);
    const replyText = input['reply_text'];
    const replyTextOk = checkFieldString(
      replyText,
      '$.reply_text',
      'reply_text',
      issues,
      MAX_REPLY_TEXT_LENGTH,
    );
    const scan = scanExpressionSegments(input['segments'], '$.segments', issues);
    if (replyTextOk && scan.structureOk && scan.texts.join('') !== replyText) {
      pushIssue(
        issues,
        '$.segments',
        'segment text must concatenate exactly to reply_text, preserving spaces and punctuation',
      );
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as ReplyDraft };
}

/** Validate a stable plan id with the same segment rules and a bounded total. */
export function validateReplyPlan(input: unknown): ValidationResult<ReplyPlan> {
  const issues: ValidationIssue[] = [];
  if (requireDataRecord(input, '$', 'reply plan', issues)) {
    checkExactKeys(input, PLAN_KEYS, '$', issues);
    checkFieldString(input['reply_id'], '$.reply_id', 'reply_id', issues, MAX_REPLY_ID_LENGTH);
    const scan = scanExpressionSegments(input['segments'], '$.segments', issues);
    if (scan.structureOk && scan.texts.join('').length > MAX_REPLY_TEXT_LENGTH) {
      pushIssue(issues, '$.segments', `joined segment text must be at most ${MAX_REPLY_TEXT_LENGTH} characters`);
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as ReplyPlan };
}

// ---------------------------------------------------------------------------
// Generated speech and measured output alignment
// ---------------------------------------------------------------------------

function checkControlList(
  input: unknown,
  path: string,
  label: string,
  issues: ValidationIssue[],
): boolean {
  if (!checkDenseArray(input, path, MAX_CONTROL_COUNT, label, issues)) {
    return false;
  }
  const seen = new Set<string>();
  let ok = true;
  input.forEach((entry, index) => {
    const entryPath = indexPath(path, index);
    if (!checkFieldString(entry, entryPath, `${label} entry`, issues, MAX_CONTROL_LENGTH)) {
      ok = false;
      return;
    }
    if (seen.has(entry)) {
      pushIssue(issues, entryPath, `${label} entries must be unique`);
      ok = false;
      return;
    }
    seen.add(entry);
  });
  return ok;
}

/** NFC normalization plus removal of Unicode punctuation and whitespace only. */
function normalizeLexical(text: string): string {
  return text.normalize('NFC').replace(/[\p{P}\s]/gu, '');
}

function mapWrapperIssuePath(path: string): string {
  const match = /^\$\.segments\[(\d+)\]\.units\[0\](.*)$/.exec(path);
  if (match !== null) {
    return `${ALIGNMENT_UNITS_PATH}[${match[1]}]${match[2]}`;
  }
  return path;
}

/**
 * Reuse the accepted annotation validation for measured output units by
 * validating an internal wrapper document against the output asset. The
 * wrapper is never returned or exposed. Annotation issues are re-emitted with
 * their structural path and a static message so no input value is echoed.
 */
function reuseAnnotationValidation(
  units: unknown[],
  asset: AudioAsset,
  issues: ValidationIssue[],
): void {
  const wrapper: AnnotatedAudio = {
    schema_version: '0.1',
    asset_id: asset.asset_id,
    transcript: '',
    segments: units.map((unit, index) => ({
      segment_id: `alignment-unit-${index}`,
      text: '',
      timing: {
        status: 'unavailable' as const,
        reason: 'wrapper segment timing is not used for generated output alignment',
      },
      units: [unit as TimedUnit],
    })),
    observations: [],
    capabilities: {
      word_timing: {
        status: 'ok',
        source_provider: 'generated-output-alignment',
        source_model: 'internal-wrapper',
      },
      emotion: { status: 'unavailable', reason: 'not applicable to generated output alignment' },
      prosody: { status: 'unavailable', reason: 'not applicable to generated output alignment' },
      sound_event: { status: 'unavailable', reason: 'not applicable to generated output alignment' },
    },
  };
  const result = validateAnnotatedAudio(wrapper, asset);
  if (result.ok) {
    return;
  }
  const reportedPaths = new Set(issues.map((issue) => issue.path));
  for (const issue of result.issues) {
    const mappedPath = mapWrapperIssuePath(issue.path);
    if (reportedPaths.has(mappedPath)) {
      continue;
    }
    reportedPaths.add(mappedPath);
    pushIssue(issues, mappedPath, 'must satisfy the accepted annotation contract for generated output');
  }
}

function checkGeneratedSpeechAlignment(
  input: unknown,
  asset: AudioAsset | null,
  replyText: string | null,
  issues: ValidationIssue[],
): void {
  if (input === null) {
    return;
  }
  if (!requireDataRecord(input, '$.alignment', 'alignment', issues)) {
    return;
  }
  checkExactKeys(input, ALIGNMENT_KEYS, '$.alignment', issues);

  const source = input['source'];
  const sourcePath = '$.alignment.source';
  const sourceOk = checkFieldString(
    source,
    sourcePath,
    'alignment source',
    issues,
    MAX_ALIGNMENT_SOURCE_LENGTH,
  );
  if (sourceOk && PLANNED_TIME_SOURCE_PATTERN.test(source)) {
    pushIssue(
      issues,
      sourcePath,
      'alignment source must describe measured output timing, not planned timing',
    );
  }

  const units = input['units'];
  if (!checkDenseArray(units, ALIGNMENT_UNITS_PATH, MAX_ALIGNMENT_UNITS, 'alignment units', issues)) {
    return;
  }
  if (units.length === 0) {
    pushIssue(issues, ALIGNMENT_UNITS_PATH, 'alignment units must contain at least 1 entry');
    return;
  }

  const texts: string[] = [];
  let previousStart: number | null = null;
  units.forEach((unit, index) => {
    const unitPath = indexPath(ALIGNMENT_UNITS_PATH, index);
    if (!requireDataRecord(unit, unitPath, 'alignment unit', issues)) {
      return;
    }
    const text = unit['text'];
    if (checkFieldString(text, joinPath(unitPath, 'text'), 'unit text', issues, null)) {
      texts.push(text);
    }
    const granularity = unit['granularity'];
    if (granularity !== 'word' && granularity !== 'character') {
      pushIssue(issues, joinPath(unitPath, 'granularity'), 'granularity must be "word" or "character"');
    }
    const timing = unit['timing'];
    const timingPath = joinPath(unitPath, 'timing');
    if (!requireDataRecord(timing, timingPath, 'unit timing', issues)) {
      return;
    }
    if (timing['status'] !== 'available') {
      pushIssue(issues, joinPath(timingPath, 'status'), 'unit timing must be "available" measured output timing');
      return;
    }
    const unitSource = timing['source'];
    const unitSourcePath = joinPath(timingPath, 'source');
    const unitSourceOk = checkFieldString(
      unitSource,
      unitSourcePath,
      'unit timing source',
      issues,
      MAX_ALIGNMENT_SOURCE_LENGTH,
    );
    if (unitSourceOk && PLANNED_TIME_SOURCE_PATTERN.test(unitSource)) {
      pushIssue(
        issues,
        unitSourcePath,
        'unit timing source must describe measured output timing, not planned timing',
      );
    }
    const start = timing['start_ms'];
    const end = timing['end_ms'];
    const startOk = Number.isSafeInteger(start) && (start as number) >= 0;
    const endOk = Number.isSafeInteger(end) && (end as number) >= 0;
    if (!startOk) {
      pushIssue(issues, joinPath(timingPath, 'start_ms'), 'start_ms must be a nonnegative safe integer');
    }
    if (!endOk) {
      pushIssue(issues, joinPath(timingPath, 'end_ms'), 'end_ms must be a nonnegative safe integer');
    }
    if (!startOk || !endOk) {
      return;
    }
    const startMs = start as number;
    const endMs = end as number;
    if (startMs >= endMs) {
      pushIssue(issues, joinPath(timingPath, 'end_ms'), 'end_ms must be greater than start_ms');
      return;
    }
    if (asset !== null && endMs > asset.duration_ms) {
      pushIssue(issues, joinPath(timingPath, 'end_ms'), 'unit timing must stay within the output asset duration');
    }
    if (previousStart !== null && startMs < previousStart) {
      pushIssue(issues, timingPath, 'unit starts must be nondecreasing (overlap allowed)');
    }
    previousStart = startMs;
  });

  if (replyText !== null && texts.length === units.length) {
    if (normalizeLexical(texts.join('')) !== normalizeLexical(replyText)) {
      pushIssue(
        issues,
        ALIGNMENT_UNITS_PATH,
        'alignment units must cover the reply text exactly after NFC normalization and removal of Unicode punctuation and whitespace',
      );
    }
  }

  if (asset !== null) {
    reuseAnnotationValidation(units, asset, issues);
  }
}

/**
 * Validate generated speech. `replyText` is the reply text that the measured
 * alignment must lexically cover; the asset is validated with the accepted
 * asset contract plus the generated-output duration bound.
 */
export function validateGeneratedSpeech(
  input: unknown,
  replyText: string,
): ValidationResult<GeneratedSpeech> {
  const issues: ValidationIssue[] = [];
  const replyTextOk = checkFieldString(
    replyText,
    'reply_text',
    'reply_text',
    issues,
    MAX_REPLY_TEXT_LENGTH,
  );

  if (requireDataRecord(input, '$', 'generated speech', issues)) {
    checkExactKeys(input, GENERATED_SPEECH_KEYS, '$', issues);

    let asset: AudioAsset | null = null;
    const assetResult = validateAudioAsset(input['asset']);
    if (assetResult.ok) {
      asset = assetResult.value;
      if (asset.duration_ms > MAX_GENERATED_AUDIO_MS) {
        pushIssue(issues, '$.asset.duration_ms', `duration_ms must be at most ${MAX_GENERATED_AUDIO_MS}`);
      }
    } else {
      issues.push(...assetResult.issues);
    }

    const storageKey = input['storage_key'];
    if (typeof storageKey !== 'string' || !STORAGE_KEY_PATTERN.test(storageKey)) {
      pushIssue(
        issues,
        '$.storage_key',
        'storage_key must be an opaque key of 1-128 characters from [A-Za-z0-9_-], never a path or URL',
      );
    }

    const appliedOk = checkControlList(
      input['applied_controls'],
      '$.applied_controls',
      'applied_controls',
      issues,
    );
    const unsupportedOk = checkControlList(
      input['unsupported_controls'],
      '$.unsupported_controls',
      'unsupported_controls',
      issues,
    );
    if (appliedOk && unsupportedOk) {
      const unsupported = new Set<string>(input['unsupported_controls'] as string[]);
      const applied = input['applied_controls'] as string[];
      if (applied.some((control) => unsupported.has(control))) {
        pushIssue(issues, '$', 'applied_controls and unsupported_controls must be disjoint');
      }
    }

    checkGeneratedSpeechAlignment(input['alignment'], asset, replyTextOk ? replyText : null, issues);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as GeneratedSpeech };
}
