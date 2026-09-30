/**
 * M01 - provider-independent audio annotation contracts and validation.
 *
 * Contract source: docs/contracts.md ("Provider-independent contracts - v0.1"),
 * realized as the v0.1 input-annotation subset assigned to M01.
 *
 * This module is intentionally dependency-free: no imports, no NestJS types and
 * no vendor SDK types. It uses erasable TypeScript syntax only, so it runs
 * unchanged under Node's built-in type stripping.
 *
 * Conventions implemented here:
 * - Times are integer milliseconds relative to the start of the associated audio
 *   asset and satisfy `0 <= start_ms < end_ms <= duration_ms` when available.
 * - Missing timing is the explicit `unavailable` timing variant carrying a
 *   reason; it is never encoded as a null/zero start-end pair.
 * - Scores keep their source semantics and are never normalized, and emotions
 *   are never inferred from text.
 * - Capability status distinguishes `ok`, `unavailable` and `failed`; an empty
 *   result set with `ok` differs from an unsupported detector.
 * - Validation never coerces, never mutates its input, never fabricates data and
 *   never throws on malformed input.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Raw metadata for one stored audio asset. No storage paths, no vendor payloads. */
export type AudioAsset = {
  asset_id: string;
  media_type: string;
  duration_ms: number;
  sample_rate_hz: number | null;
  channels: number | null;
};

/**
 * Discriminated timing union. `available` carries measured (or provider-reported)
 * integer millisecond bounds plus a source; `unavailable` carries an explicit
 * reason and no times at all.
 */
export type Timing =
  | { status: 'available'; start_ms: number; end_ms: number; source: string }
  | { status: 'unavailable'; reason: string };

export type TimingGranularity = 'word' | 'character';

/** A nested word/character unit inside a transcript segment. */
export type TimedUnit = {
  text: string;
  granularity: TimingGranularity;
  timing: Timing;
};

export type TranscriptSegment = {
  segment_id: string;
  text: string;
  speaker_id?: string;
  timing: Timing;
  units?: TimedUnit[];
};

export type ScoreSemantics = 'probability' | 'confidence' | 'ordinal' | 'uncalibrated_score';

/** A numeric score together with the meaning its source assigned to it. */
export type Score = {
  value: number;
  semantics: ScoreSemantics;
};

export type ObservationKind = 'emotion' | 'prosody' | 'sound_event';

export type Observation = {
  observation_id: string;
  kind: ObservationKind;
  label: string;
  timing: Timing;
  source_provider: string;
  source_model: string;
  score?: Score;
  segment_ids?: string[];
};

export type CapabilityStatus = 'ok' | 'unavailable' | 'failed';

/**
 * Capability state for one analysis dimension. `ok` requires provenance; a gap
 * requires a reason and may optionally keep partial provenance.
 */
export type Capability =
  | { status: 'ok'; source_provider: string; source_model: string }
  | {
      status: 'unavailable' | 'failed';
      reason: string;
      source_provider?: string;
      source_model?: string;
    };

export type Capabilities = {
  word_timing: Capability;
  emotion: Capability;
  prosody: Capability;
  sound_event: Capability;
};

export type AnnotatedAudio = {
  schema_version: '0.1';
  asset_id: string;
  transcript: string;
  segments: TranscriptSegment[];
  observations: Observation[];
  capabilities: Capabilities;
};

/** One validation problem, addressed by a JSON-like path such as `$.segments[0].timing.start_ms`. */
export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

// ---------------------------------------------------------------------------
// Validation internals
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '0.1';
const MEDIA_TYPE_PREFIX = 'audio/';

const AUDIO_ASSET_KEYS: readonly string[] = [
  'asset_id',
  'media_type',
  'duration_ms',
  'sample_rate_hz',
  'channels',
];
const TIMING_AVAILABLE_KEYS: readonly string[] = ['status', 'start_ms', 'end_ms', 'source'];
const TIMING_UNAVAILABLE_KEYS: readonly string[] = ['status', 'reason'];
const TIMED_UNIT_KEYS: readonly string[] = ['text', 'granularity', 'timing'];
const SEGMENT_KEYS: readonly string[] = ['segment_id', 'text', 'speaker_id', 'timing', 'units'];
const SCORE_KEYS: readonly string[] = ['value', 'semantics'];
const OBSERVATION_KEYS: readonly string[] = [
  'observation_id',
  'kind',
  'label',
  'timing',
  'source_provider',
  'source_model',
  'score',
  'segment_ids',
];
const CAPABILITY_OK_KEYS: readonly string[] = ['status', 'source_provider', 'source_model'];
const CAPABILITY_GAP_KEYS: readonly string[] = [
  'status',
  'reason',
  'source_provider',
  'source_model',
];
const CAPABILITIES_KEYS: readonly string[] = [
  'word_timing',
  'emotion',
  'prosody',
  'sound_event',
];
const ANNOTATED_AUDIO_KEYS: readonly string[] = [
  'schema_version',
  'asset_id',
  'transcript',
  'segments',
  'observations',
  'capabilities',
];

/** Root path used for `AudioAsset` issues when an asset is validated as a function argument. */
const ASSET_ROOT = 'asset';
/** Root path used for `AnnotatedAudio` issues. */
const DOCUMENT_ROOT = '$';

/** Maximum number of issues embedded in the error thrown by `serializeAnnotatedAudio`. */
const MAX_THROWN_ISSUES = 10;

type JsonObject = Record<string, unknown>;

type ResolvedTiming =
  | { status: 'available'; start_ms: number; end_ms: number }
  | { status: 'unavailable' };

/**
 * A plain JSON record: an object whose prototype is `Object.prototype` or
 * `null`. Class instances and objects that inherit their fields from another
 * record (for example `Object.create(validDocument)`) are rejected here, since
 * they would otherwise pass validation and then serialize to `{}`.
 */
function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject own accessor (getter/setter) properties and symbol keys before any
 * field of the record is read: field access must not run user getters, and
 * symbol keys would be dropped by a JSON round-trip.
 */
function checkRecordShape(value: JsonObject, path: string, issues: ValidationIssue[]): boolean {
  let isPlainDataRecord = true;
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    pushIssue(
      issues,
      path,
      `symbol-keyed property "${String(symbol)}" is not part of the v0.1 contract`,
    );
    isPlainDataRecord = false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) {
      pushIssue(
        issues,
        joinPath(path, key),
        `property "${key}" must be a plain data property, not a getter or setter`,
      );
      isPlainDataRecord = false;
    }
  }
  return isPlainDataRecord;
}

/**
 * `isJsonObject` plus `checkRecordShape`. A `false` result means the caller
 * must stop reading fields from the value; `message` is pushed when the value
 * is not a plain JSON record at all.
 */
function requirePlainRecord(
  input: unknown,
  path: string,
  message: string,
  issues: ValidationIssue[],
): input is JsonObject {
  if (!isJsonObject(input)) {
    pushIssue(issues, path, message);
    return false;
  }
  return checkRecordShape(input, path, issues);
}

/** Canonical non-negative array index keys: `0`, `1`, ... (no leading zeros). */
const ARRAY_INDEX_KEY = /^(?:0|[1-9][0-9]*)$/;

function isArrayIndexKey(key: string): boolean {
  return ARRAY_INDEX_KEY.test(key) && Number(key) < 4294967295;
}

/**
 * Verify that a schema array is a dense JSON-domain container. `Array#forEach`
 * skips holes and `JSON.stringify` writes them as `null`, so missing own
 * indexed elements and non-index array properties are reported here instead of
 * silently passing validation.
 */
function checkArrayShape(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): input is unknown[] {
  if (!Array.isArray(input)) {
    return false;
  }
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input, index)) {
      pushIssue(
        issues,
        indexPath(path, index),
        'array element is missing (sparse array); a JSON round-trip would not preserve this array',
      );
    }
  }
  for (const key of Object.keys(input)) {
    if (!isArrayIndexKey(key)) {
      pushIssue(
        issues,
        joinPath(path, key),
        `non-index array property "${key}" is not part of the v0.1 contract`,
      );
    }
  }
  for (const symbol of Object.getOwnPropertySymbols(input)) {
    pushIssue(
      issues,
      path,
      `symbol-keyed array property "${String(symbol)}" is not part of the v0.1 contract`,
    );
  }
  return true;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function joinPath(base: string, key: string): string {
  return `${base}.${key}`;
}

function indexPath(base: string, index: number): string {
  return `${base}[${index}]`;
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

/** Reject keys that are not part of the v0.1 schema instead of silently dropping them. */
function checkKnownKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      pushIssue(issues, joinPath(path, key), `unknown key "${key}" is not part of the v0.1 contract`);
    }
  }
}

/** Nonempty string check (no trimming, no coercion). */
function checkNonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  label: string,
): boolean {
  if (typeof value !== 'string') {
    pushIssue(issues, path, `${label} must be a string`);
    return false;
  }
  if (value.length === 0) {
    pushIssue(issues, path, `${label} must be a nonempty string`);
    return false;
  }
  return true;
}

/** Plain string check; empty strings are allowed (silence, empty transcript). */
function checkString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  label: string,
): boolean {
  if (typeof value !== 'string') {
    pushIssue(issues, path, `${label} must be a string (an empty string is allowed)`);
    return false;
  }
  return true;
}

function checkMediaType(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || value.length === 0) {
    pushIssue(issues, path, 'media_type must be a nonempty string');
    return;
  }
  if (!value.startsWith(MEDIA_TYPE_PREFIX) || value.length === MEDIA_TYPE_PREFIX.length) {
    pushIssue(issues, path, 'media_type must be an audio MIME type starting with "audio/"');
  }
}

function checkNullablePositiveSafeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  label: string,
): void {
  if (value === null) {
    return;
  }
  if (!isSafeInteger(value) || value <= 0) {
    pushIssue(issues, path, `${label} must be a positive safe integer, or null when unavailable`);
  }
}

function validateAudioAssetInto(input: unknown, root: string, issues: ValidationIssue[]): void {
  if (!requirePlainRecord(input, root, 'AudioAsset must be an object', issues)) {
    return;
  }
  checkKnownKeys(input, AUDIO_ASSET_KEYS, root, issues);
  checkNonEmptyString(input['asset_id'], joinPath(root, 'asset_id'), issues, 'asset_id');
  checkMediaType(input['media_type'], joinPath(root, 'media_type'), issues);
  const duration = input['duration_ms'];
  if (!isSafeInteger(duration) || duration <= 0) {
    pushIssue(issues, joinPath(root, 'duration_ms'), 'duration_ms must be a positive safe integer');
  }
  checkNullablePositiveSafeInteger(
    input['sample_rate_hz'],
    joinPath(root, 'sample_rate_hz'),
    issues,
    'sample_rate_hz',
  );
  checkNullablePositiveSafeInteger(input['channels'], joinPath(root, 'channels'), issues, 'channels');
}

/**
 * Validate a `Timing` value. Returns the resolved interval only when the timing
 * is fully valid, so callers can use it for nested containment checks.
 */
function validateTimingInto(
  input: unknown,
  path: string,
  durationMs: number,
  issues: ValidationIssue[],
): ResolvedTiming | null {
  const firstIssueIndex = issues.length;
  if (
    !requirePlainRecord(
      input,
      path,
      'timing must be an object with status "available" or "unavailable"',
      issues,
    )
  ) {
    return null;
  }
  const status = input['status'];

  if (status === 'available') {
    checkKnownKeys(input, TIMING_AVAILABLE_KEYS, path, issues);
    const start = input['start_ms'];
    const end = input['end_ms'];
    if (!isSafeInteger(start)) {
      pushIssue(issues, joinPath(path, 'start_ms'), 'start_ms must be a safe integer');
    }
    if (!isSafeInteger(end)) {
      pushIssue(issues, joinPath(path, 'end_ms'), 'end_ms must be a safe integer');
    }
    checkNonEmptyString(input['source'], joinPath(path, 'source'), issues, 'source');

    let startMs: number | null = null;
    let endMs: number | null = null;
    if (isSafeInteger(start) && isSafeInteger(end)) {
      if (start < 0) {
        pushIssue(
          issues,
          joinPath(path, 'start_ms'),
          `start_ms must be >= 0; received ${start}`,
        );
      }
      if (end > durationMs) {
        pushIssue(
          issues,
          joinPath(path, 'end_ms'),
          `end_ms must be <= asset duration_ms (${durationMs}); received ${end}`,
        );
      }
      if (start >= end) {
        pushIssue(
          issues,
          joinPath(path, 'end_ms'),
          `end_ms must be greater than start_ms; received start_ms=${start}, end_ms=${end}`,
        );
      }
      if (start >= 0 && start < end && end <= durationMs) {
        startMs = start;
        endMs = end;
      }
    }

    if (issues.length !== firstIssueIndex || startMs === null || endMs === null) {
      return null;
    }
    return { status: 'available', start_ms: startMs, end_ms: endMs };
  }

  if (status === 'unavailable') {
    checkKnownKeys(input, TIMING_UNAVAILABLE_KEYS, path, issues);
    checkNonEmptyString(input['reason'], joinPath(path, 'reason'), issues, 'reason');
    if (issues.length !== firstIssueIndex) {
      return null;
    }
    return { status: 'unavailable' };
  }

  pushIssue(issues, joinPath(path, 'status'), 'status must be "available" or "unavailable"');
  return null;
}

function validateScoreInto(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    !requirePlainRecord(input, path, 'score must be an object with value and semantics', issues)
  ) {
    return;
  }
  checkKnownKeys(input, SCORE_KEYS, path, issues);

  const value = input['value'];
  const semantics = input['semantics'];
  const valueIsFiniteNumber = typeof value === 'number' && Number.isFinite(value);
  if (!valueIsFiniteNumber) {
    pushIssue(issues, joinPath(path, 'value'), 'score value must be a finite number');
  }

  if (
    semantics !== 'probability' &&
    semantics !== 'confidence' &&
    semantics !== 'ordinal' &&
    semantics !== 'uncalibrated_score'
  ) {
    pushIssue(
      issues,
      joinPath(path, 'semantics'),
      'semantics must be "probability", "confidence", "ordinal" or "uncalibrated_score"',
    );
    return;
  }

  if (
    valueIsFiniteNumber &&
    (semantics === 'probability' || semantics === 'confidence') &&
    (value < 0 || value > 1)
  ) {
    pushIssue(
      issues,
      joinPath(path, 'value'),
      `score value with semantics "${semantics}" must be between 0 and 1; received ${value}`,
    );
  }
}

function validateUnitsInto(
  input: unknown,
  path: string,
  durationMs: number,
  segmentTiming: ResolvedTiming | null,
  wordTimingOk: boolean,
  issues: ValidationIssue[],
): void {
  if (!checkArrayShape(input, path, issues)) {
    pushIssue(issues, path, 'units must be an array');
    return;
  }
  input.forEach((raw, index) => {
    const unitPath = indexPath(path, index);
    if (!requirePlainRecord(raw, unitPath, 'unit must be an object', issues)) {
      return;
    }
    checkKnownKeys(raw, TIMED_UNIT_KEYS, unitPath, issues);
    checkNonEmptyString(raw['text'], joinPath(unitPath, 'text'), issues, 'unit text');

    const granularity = raw['granularity'];
    if (granularity !== 'word' && granularity !== 'character') {
      pushIssue(
        issues,
        joinPath(unitPath, 'granularity'),
        'granularity must be "word" or "character"',
      );
    }

    const unitTiming = validateTimingInto(
      raw['timing'],
      joinPath(unitPath, 'timing'),
      durationMs,
      issues,
    );
    if (unitTiming === null || unitTiming.status !== 'available') {
      return;
    }
    if (!wordTimingOk) {
      pushIssue(
        issues,
        joinPath(unitPath, 'timing'),
        'measured unit timing requires capabilities.word_timing.status to be "ok"',
      );
    }
    if (
      segmentTiming !== null &&
      segmentTiming.status === 'available' &&
      (unitTiming.start_ms < segmentTiming.start_ms || unitTiming.end_ms > segmentTiming.end_ms)
    ) {
      pushIssue(
        issues,
        joinPath(unitPath, 'timing'),
        `unit timing must stay inside the parent segment timing (${segmentTiming.start_ms}..${segmentTiming.end_ms}); received ${unitTiming.start_ms}..${unitTiming.end_ms}`,
      );
    }
  });
}

function validateSegmentsInto(
  input: unknown,
  path: string,
  durationMs: number,
  wordTimingOk: boolean,
  issues: ValidationIssue[],
): Set<string> {
  const segmentIds = new Set<string>();
  if (!checkArrayShape(input, path, issues)) {
    pushIssue(issues, path, 'segments must be an array');
    return segmentIds;
  }
  input.forEach((raw, index) => {
    const segmentPath = indexPath(path, index);
    if (!requirePlainRecord(raw, segmentPath, 'segment must be an object', issues)) {
      return;
    }
    checkKnownKeys(raw, SEGMENT_KEYS, segmentPath, issues);

    const segmentId = raw['segment_id'];
    if (checkNonEmptyString(segmentId, joinPath(segmentPath, 'segment_id'), issues, 'segment_id')) {
      const id = segmentId as string;
      if (segmentIds.has(id)) {
        pushIssue(issues, joinPath(segmentPath, 'segment_id'), `duplicate segment_id "${id}"`);
      } else {
        segmentIds.add(id);
      }
    }

    checkString(raw['text'], joinPath(segmentPath, 'text'), issues, 'segment text');

    const speakerId = raw['speaker_id'];
    if (speakerId !== undefined) {
      checkNonEmptyString(speakerId, joinPath(segmentPath, 'speaker_id'), issues, 'speaker_id');
    }

    const segmentTiming = validateTimingInto(
      raw['timing'],
      joinPath(segmentPath, 'timing'),
      durationMs,
      issues,
    );

    const units = raw['units'];
    if (units !== undefined) {
      validateUnitsInto(
        units,
        joinPath(segmentPath, 'units'),
        durationMs,
        segmentTiming,
        wordTimingOk,
        issues,
      );
    }
  });
  return segmentIds;
}

function validateObservationsInto(
  input: unknown,
  path: string,
  durationMs: number,
  capabilityStatuses: Record<ObservationKind, CapabilityStatus | null>,
  segmentIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!checkArrayShape(input, path, issues)) {
    pushIssue(issues, path, 'observations must be an array');
    return;
  }
  const observationIds = new Set<string>();
  input.forEach((raw, index) => {
    const observationPath = indexPath(path, index);
    if (!requirePlainRecord(raw, observationPath, 'observation must be an object', issues)) {
      return;
    }
    checkKnownKeys(raw, OBSERVATION_KEYS, observationPath, issues);

    const observationId = raw['observation_id'];
    if (
      checkNonEmptyString(
        observationId,
        joinPath(observationPath, 'observation_id'),
        issues,
        'observation_id',
      )
    ) {
      const id = observationId as string;
      if (observationIds.has(id)) {
        pushIssue(
          issues,
          joinPath(observationPath, 'observation_id'),
          `duplicate observation_id "${id}"`,
        );
      } else {
        observationIds.add(id);
      }
    }

    const kind = raw['kind'];
    if (kind === 'emotion' || kind === 'prosody' || kind === 'sound_event') {
      if (capabilityStatuses[kind] !== 'ok') {
        pushIssue(
          issues,
          joinPath(observationPath, 'kind'),
          `observations of kind "${kind}" require capabilities.${kind}.status to be "ok"`,
        );
      }
    } else {
      pushIssue(
        issues,
        joinPath(observationPath, 'kind'),
        'kind must be "emotion", "prosody" or "sound_event"',
      );
    }

    checkNonEmptyString(raw['label'], joinPath(observationPath, 'label'), issues, 'label');
    validateTimingInto(
      raw['timing'],
      joinPath(observationPath, 'timing'),
      durationMs,
      issues,
    );
    checkNonEmptyString(
      raw['source_provider'],
      joinPath(observationPath, 'source_provider'),
      issues,
      'source_provider',
    );
    checkNonEmptyString(
      raw['source_model'],
      joinPath(observationPath, 'source_model'),
      issues,
      'source_model',
    );

    const score = raw['score'];
    if (score !== undefined) {
      validateScoreInto(score, joinPath(observationPath, 'score'), issues);
    }

    const references = raw['segment_ids'];
    if (references === undefined) {
      return;
    }
    const referencesPath = joinPath(observationPath, 'segment_ids');
    if (!checkArrayShape(references, referencesPath, issues)) {
      pushIssue(issues, referencesPath, 'segment_ids must be an array');
      return;
    }
    references.forEach((reference, referenceIndex) => {
      const referencePath = indexPath(referencesPath, referenceIndex);
      if (!checkNonEmptyString(reference, referencePath, issues, 'segment_id reference')) {
        return;
      }
      const referenceId = reference as string;
      if (!segmentIds.has(referenceId)) {
        pushIssue(issues, referencePath, `references unknown segment_id "${referenceId}"`);
      }
    });
  });
}

function validateCapabilityInto(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): CapabilityStatus | null {
  if (!requirePlainRecord(input, path, 'capability must be an object with a status', issues)) {
    return null;
  }
  const status = input['status'];

  if (status === 'ok') {
    checkKnownKeys(input, CAPABILITY_OK_KEYS, path, issues);
    checkNonEmptyString(
      input['source_provider'],
      joinPath(path, 'source_provider'),
      issues,
      'source_provider',
    );
    checkNonEmptyString(
      input['source_model'],
      joinPath(path, 'source_model'),
      issues,
      'source_model',
    );
    return 'ok';
  }

  if (status === 'unavailable' || status === 'failed') {
    checkKnownKeys(input, CAPABILITY_GAP_KEYS, path, issues);
    checkNonEmptyString(input['reason'], joinPath(path, 'reason'), issues, 'reason');
    if (input['source_provider'] !== undefined) {
      checkNonEmptyString(
        input['source_provider'],
        joinPath(path, 'source_provider'),
        issues,
        'source_provider',
      );
    }
    if (input['source_model'] !== undefined) {
      checkNonEmptyString(
        input['source_model'],
        joinPath(path, 'source_model'),
        issues,
        'source_model',
      );
    }
    return status;
  }

  pushIssue(
    issues,
    joinPath(path, 'status'),
    'status must be "ok", "unavailable" or "failed"',
  );
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateAudioAsset(input: unknown): ValidationResult<AudioAsset> {
  const issues: ValidationIssue[] = [];
  validateAudioAssetInto(input, DOCUMENT_ROOT, issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as AudioAsset };
}

export function validateAnnotatedAudio(
  input: unknown,
  asset: AudioAsset,
): ValidationResult<AnnotatedAudio> {
  const issues: ValidationIssue[] = [];

  const assetIssueStart = issues.length;
  validateAudioAssetInto(asset, ASSET_ROOT, issues);
  if (issues.length > assetIssueStart) {
    return { ok: false, issues };
  }

  if (!requirePlainRecord(input, DOCUMENT_ROOT, 'AnnotatedAudio must be an object', issues)) {
    return { ok: false, issues };
  }
  checkKnownKeys(input, ANNOTATED_AUDIO_KEYS, DOCUMENT_ROOT, issues);

  if (input['schema_version'] !== SCHEMA_VERSION) {
    pushIssue(
      issues,
      joinPath(DOCUMENT_ROOT, 'schema_version'),
      `schema_version must be "${SCHEMA_VERSION}"`,
    );
  }

  const documentAssetId = input['asset_id'];
  if (
    checkNonEmptyString(
      documentAssetId,
      joinPath(DOCUMENT_ROOT, 'asset_id'),
      issues,
      'asset_id',
    ) &&
    documentAssetId !== asset.asset_id
  ) {
    pushIssue(
      issues,
      joinPath(DOCUMENT_ROOT, 'asset_id'),
      `must match the validated asset asset_id "${asset.asset_id}"`,
    );
  }

  checkString(input['transcript'], joinPath(DOCUMENT_ROOT, 'transcript'), issues, 'transcript');

  const capabilityStatuses: Record<ObservationKind, CapabilityStatus | null> = {
    emotion: null,
    prosody: null,
    sound_event: null,
  };
  let wordTimingOk = false;

  const capabilitiesRaw = input['capabilities'];
  const capabilitiesPath = joinPath(DOCUMENT_ROOT, 'capabilities');
  const capabilitiesValid = requirePlainRecord(
    capabilitiesRaw,
    capabilitiesPath,
    'capabilities must be an object with word_timing, emotion, prosody and sound_event',
    issues,
  );
  if (capabilitiesValid) {
    checkKnownKeys(capabilitiesRaw, CAPABILITIES_KEYS, capabilitiesPath, issues);
    wordTimingOk =
      validateCapabilityInto(
        capabilitiesRaw['word_timing'],
        joinPath(capabilitiesPath, 'word_timing'),
        issues,
      ) === 'ok';
    capabilityStatuses.emotion = validateCapabilityInto(
      capabilitiesRaw['emotion'],
      joinPath(capabilitiesPath, 'emotion'),
      issues,
    );
    capabilityStatuses.prosody = validateCapabilityInto(
      capabilitiesRaw['prosody'],
      joinPath(capabilitiesPath, 'prosody'),
      issues,
    );
    capabilityStatuses.sound_event = validateCapabilityInto(
      capabilitiesRaw['sound_event'],
      joinPath(capabilitiesPath, 'sound_event'),
      issues,
    );
  }

  const segmentIds = validateSegmentsInto(
    input['segments'],
    joinPath(DOCUMENT_ROOT, 'segments'),
    asset.duration_ms,
    wordTimingOk,
    issues,
  );
  validateObservationsInto(
    input['observations'],
    joinPath(DOCUMENT_ROOT, 'observations'),
    asset.duration_ms,
    capabilityStatuses,
    segmentIds,
    issues,
  );

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as AnnotatedAudio };
}

export function parseAnnotatedAudio(
  json: string,
  asset: AudioAsset,
): ValidationResult<AnnotatedAudio> {
  const input: unknown = json;
  if (typeof input !== 'string') {
    return {
      ok: false,
      issues: [{ path: DOCUMENT_ROOT, message: 'input must be a JSON string' }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      ok: false,
      issues: [{ path: DOCUMENT_ROOT, message: 'input is not valid JSON' }],
    };
  }
  return validateAnnotatedAudio(parsed, asset);
}

export function serializeAnnotatedAudio(document: AnnotatedAudio, asset: AudioAsset): string {
  const result = validateAnnotatedAudio(document, asset);
  if (!result.ok) {
    const shown = result.issues
      .slice(0, MAX_THROWN_ISSUES)
      .map((issue) => `${issue.path}: ${issue.message}`);
    const remaining = result.issues.length - shown.length;
    const suffix = remaining > 0 ? `; and ${remaining} more issue(s)` : '';
    throw new Error(`Invalid AnnotatedAudio: ${shown.join('; ')}${suffix}`);
  }
  return JSON.stringify(result.value);
}
