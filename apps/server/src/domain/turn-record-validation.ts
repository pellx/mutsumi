/**
 * M03 - turn-record boundary validation.
 *
 * Contract source: docs/sleep-work-plan.md (M03) with the record types from
 * ./conversation.ts and the accepted input-annotation validation in
 * ./annotation.ts.
 *
 * Conventions (mirroring M01 and the M03 conversation validators):
 * - Validation never throws, never coerces, never mutates, never fabricates and
 *   never echoes input values in its own issue messages. A success returns the
 *   original input value unchanged.
 * - A bounded read-only preflight walks the whole tree before any field is
 *   read. Cycles, accessors, symbol keys, non-enumerable own properties, class
 *   instances, sparse/decorated arrays and non-JSON values are rejected there,
 *   and nesting, value counts, array lengths, key counts and string lengths are
 *   bounded so adversarial input cannot force unbounded work. Plain objects and
 *   null-prototype records are accepted, and shared non-cyclic references are
 *   allowed. Arbitrary adversarial Proxy objects are outside the guarantee.
 * - Planned expression timing stays a plan: output alignment is measured timing
 *   for a real generated asset, or explicitly null. A completed round may
 *   legitimately keep alignment null.
 * - The generated-speech wrapper built to reuse validateGeneratedSpeech carries
 *   a fixed validation-only storage key and is never returned; only its
 *   validated asset is kept, so no internal key can reach the record.
 */

import type { AudioAsset, ValidationIssue, ValidationResult } from './annotation.ts';
import { validateAnnotatedAudio, validateAudioAsset } from './annotation.ts';
import type {
  ReplyDraft,
  ReplyPlan,
  RoundFailureCode,
  RoundStage,
  TurnRecord,
} from './conversation.ts';
import {
  validateGeneratedSpeech,
  validateReplyDraft,
  validateReplyPlan,
} from './conversation-validation.ts';

type DataRecord = Record<string, unknown>;

const ROOT_PATH = '$';

// Bounded preflight limits (JSON-tree safety, not part of the domain contract).
const MAX_DEPTH = 16;
const MAX_TOTAL_VALUES = 131_072;
const MAX_ARRAY_LENGTH = 8_192;
const MAX_OBJECT_KEYS = 32;
const MAX_STRING_LENGTH = 65_536;

// Domain limits.
const MAX_ID_LENGTH = 128;
const MAX_SOURCE_ASSET_MS = 30_250;
const MAX_INPUT_ASSET_MS = 30_000;
const MAX_REASON_LENGTH = 256;

const TURN_RECORD_KEYS: readonly string[] = [
  'turn_id',
  'session_id',
  'client_request_id',
  'created_at_ms',
  'mode',
  'source_asset',
  'input_asset',
  'annotation',
  'reply_draft',
  'reply_plan',
  'output_asset',
  'output_alignment',
  'applied_controls',
  'unsupported_controls',
  'playback_completed',
  'stages',
  'failure',
];
const FAILURE_KEYS: readonly string[] = ['code', 'stage', 'message', 'retryable'];
const STAGE_OUTCOME_KEYS: readonly string[] = ['status', 'reason'];
const ASSET_KEYS: readonly string[] = [
  'asset_id',
  'media_type',
  'duration_ms',
  'sample_rate_hz',
  'channels',
];

const ROUND_STAGES: readonly string[] = [
  'intake',
  'analysis',
  'context',
  'dialogue',
  'expression',
  'synthesis',
  'storage',
  'complete',
];
const PRIOR_STAGES: readonly string[] = [
  'intake',
  'analysis',
  'context',
  'dialogue',
  'expression',
  'synthesis',
  'storage',
];
const ROUND_FAILURE_CODES: readonly RoundFailureCode[] = [
  'invalid_input',
  'busy',
  'not_found',
  'provider_unavailable',
  'cancelled',
  'timed_out',
  'provider_failed',
  'invalid_result',
  'storage_failed',
];
const STAGE_STATUS_VALUES: readonly string[] = ['ok', 'unavailable', 'failed', 'skipped'];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ARRAY_INDEX_KEY_PATTERN = /^(?:0|[1-9][0-9]*)$/;
/** Fixed internal key used only so generated-output validation can run; never returned. */
const VALIDATION_ONLY_STORAGE_KEY = 'turn-record-validation-only';

// ---------------------------------------------------------------------------
// Static issue helpers
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

function isArrayIndexKey(key: string): boolean {
  return ARRAY_INDEX_KEY_PATTERN.test(key) && Number(key) < 4294967295;
}

function isPlainRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkExactKeys(
  value: DataRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key) === false) {
      pushIssue(issues, joinPath(path, key), 'unknown field is not part of the turn-record contract');
    }
  }
  for (const key of allowed) {
    if (Object.hasOwn(value, key) === false) {
      pushIssue(issues, joinPath(path, key), 'required field is missing');
    }
  }
}

function checkIdField(value: unknown, path: string, label: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || ID_PATTERN.test(value) === false) {
    pushIssue(
      issues,
      path,
      `${label} must be 1-${MAX_ID_LENGTH} opaque characters from [A-Za-z0-9_-]`,
    );
  }
}

function checkNonblankReason(
  value: unknown,
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'string' || value.length > MAX_REASON_LENGTH || /\S/.test(value) === false) {
    pushIssue(issues, path, `${label} must be a nonblank string of at most ${MAX_REASON_LENGTH} characters`);
  }
}

/**
 * Re-emit an accepted nested validator's findings under this record's path with
 * a static description, so no foreign validator text reaches the caller.
 */
function appendNestedIssues(
  reused: readonly ValidationIssue[],
  base: string,
  description: string,
  issues: ValidationIssue[],
): void {
  for (const issue of reused) {
    if (issue.path === ROOT_PATH) {
      pushIssue(issues, base, description);
    } else if (issue.path.startsWith('$.')) {
      pushIssue(issues, `${base}${issue.path.slice(1)}`, description);
    } else {
      pushIssue(issues, `${base}.${issue.path}`, description);
    }
  }
}

/** Map an internal generated-speech wrapper path onto the turn record, or `null` to drop it. */
function mapGeneratedSpeechPath(path: string): string | null {
  if (path === ROOT_PATH) {
    return ROOT_PATH;
  }
  if (path === '$.storage_key' || path.startsWith('$.storage_key.')) {
    return null;
  }
  if (path === '$.alignment' || path.startsWith('$.alignment.')) {
    return `$.output_alignment${path.slice('$.alignment'.length)}`;
  }
  if (path === '$.asset' || path.startsWith('$.asset.')) {
    return `$.output_asset${path.slice('$.asset'.length)}`;
  }
  if (ASSET_KEYS.some((key) => path === `$.${key}`)) {
    return `$.output_asset${path.slice(1)}`;
  }
  if (path === 'reply_text') {
    return '$.reply_draft.reply_text';
  }
  return path;
}

function appendGeneratedSpeechIssues(
  reused: readonly ValidationIssue[],
  issues: ValidationIssue[],
): void {
  for (const issue of reused) {
    const mapped = mapGeneratedSpeechPath(issue.path);
    if (mapped !== null) {
      pushIssue(issues, mapped, 'must satisfy the accepted generated-speech contract for the output asset');
    }
  }
}

function checkEmptyControls(
  value: unknown,
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  if (Array.isArray(value) === false || value.length !== 0) {
    pushIssue(issues, path, `${label} must be an empty array when there is no output_asset`);
  }
}

// ---------------------------------------------------------------------------
// Bounded read-only JSON-tree preflight
// ---------------------------------------------------------------------------

/**
 * Walk the whole tree without reading any field of a container that is not a
 * plain JSON record or an ordinary dense array. A `false` result means the
 * caller must not attempt field validation at all. Each distinct container is
 * inspected once, and containers currently on the walk stack identify cycles,
 * so shared non-cyclic references stay valid without unbounded work.
 */
function preflight(root: unknown, issues: ValidationIssue[]): boolean {
  const visiting = new Set<object>();
  const visited = new Set<object>();
  let valueCount = 0;
  let limitReported = false;
  let ok = true;

  const note = (path: string, message: string): void => {
    pushIssue(issues, path, message);
    ok = false;
  };

  const walkArray = (array: unknown[], depth: number, path: string): void => {
    if (Object.getPrototypeOf(array) !== Array.prototype) {
      note(path, 'array must be an ordinary Array.prototype array');
      return;
    }
    if (array.length > MAX_ARRAY_LENGTH) {
      note(path, `array must contain at most ${MAX_ARRAY_LENGTH} entries`);
      return;
    }
    let shapeOk = true;
    for (let index = 0; index < array.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(array, index);
      if (descriptor === undefined) {
        note(indexPath(path, index), 'array element is missing (sparse array)');
        shapeOk = false;
        continue;
      }
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        note(indexPath(path, index), 'array element must be a plain data property');
        shapeOk = false;
        continue;
      }
      if (descriptor.enumerable === false) {
        note(indexPath(path, index), 'array element must be an enumerable own property');
        shapeOk = false;
      }
    }
    for (const key of Object.getOwnPropertyNames(array)) {
      if (key === 'length' || isArrayIndexKey(key)) {
        continue;
      }
      note(joinPath(path, key), 'non-index array property is not part of the contract');
      shapeOk = false;
    }
    if (Object.getOwnPropertySymbols(array).length > 0) {
      note(path, 'symbol-keyed array property is not part of the contract');
      shapeOk = false;
    }
    if (shapeOk === false) {
      return;
    }
    for (let index = 0; index < array.length; index += 1) {
      walk(array[index], depth + 1, indexPath(path, index));
    }
  };

  const walkRecord = (value: DataRecord, depth: number, path: string): void => {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      note(path, 'object must be a plain object or a null-prototype record');
      return;
    }
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length > MAX_OBJECT_KEYS) {
      note(path, `object must have at most ${MAX_OBJECT_KEYS} keys`);
      return;
    }
    let shapeOk = true;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) {
        continue;
      }
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        note(joinPath(path, key), 'property must be a plain data property, not a getter or setter');
        shapeOk = false;
        continue;
      }
      if (descriptor.enumerable === false) {
        note(joinPath(path, key), 'property must be an enumerable own property');
        shapeOk = false;
      }
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      note(path, 'symbol-keyed property is not part of the contract');
      shapeOk = false;
    }
    if (shapeOk === false) {
      return;
    }
    for (const key of keys) {
      walk(value[key], depth + 1, joinPath(path, key));
    }
  };

  const walk = (value: unknown, depth: number, path: string): void => {
    valueCount += 1;
    if (valueCount > MAX_TOTAL_VALUES) {
      if (limitReported === false) {
        limitReported = true;
        note(ROOT_PATH, `turn record must contain at most ${MAX_TOTAL_VALUES} values`);
      }
      return;
    }
    if (value === null || typeof value === 'boolean') {
      return;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        note(path, `string must be at most ${MAX_STRING_LENGTH} UTF-16 units`);
      }
      return;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value) === false) {
        note(path, 'number must be a finite JSON number');
      }
      return;
    }
    if (typeof value !== 'object') {
      note(path, 'value must be JSON data; undefined, functions, symbols and bigints are not allowed');
      return;
    }
    const container = value;
    if (depth > MAX_DEPTH) {
      note(path, `value must not nest deeper than ${MAX_DEPTH} levels`);
      return;
    }
    if (visiting.has(container)) {
      note(path, 'must not contain a reference cycle');
      return;
    }
    if (visited.has(container)) {
      return;
    }
    visiting.add(container);
    if (Array.isArray(container)) {
      walkArray(container, depth, path);
    } else {
      walkRecord(container as DataRecord, depth, path);
    }
    visiting.delete(container);
    visited.add(container);
  };

  walk(root, 0, ROOT_PATH);
  return ok;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate one complete or partial round record. */
export function validateTurnRecord(input: unknown): ValidationResult<TurnRecord> {
  const issues: ValidationIssue[] = [];

  if (preflight(input, issues) === false) {
    return { ok: false, issues };
  }
  if (isPlainRecord(input) === false) {
    return { ok: false, issues: [{ path: ROOT_PATH, message: 'turn record must be a plain object' }] };
  }
  const record: DataRecord = input;

  checkExactKeys(record, TURN_RECORD_KEYS, ROOT_PATH, issues);
  checkIdField(record['turn_id'], '$.turn_id', 'turn_id', issues);
  checkIdField(record['session_id'], '$.session_id', 'session_id', issues);
  checkIdField(record['client_request_id'], '$.client_request_id', 'client_request_id', issues);

  const createdAt = record['created_at_ms'];
  if (typeof createdAt !== 'number' || Number.isSafeInteger(createdAt) === false || createdAt < 0) {
    pushIssue(issues, '$.created_at_ms', 'created_at_ms must be a nonnegative safe integer');
  }

  const mode = record['mode'];
  if (mode !== 'live' && mode !== 'development-mock') {
    pushIssue(issues, '$.mode', 'mode must be "live" or "development-mock"');
  }

  const sourceResult = validateAudioAsset(record['source_asset']);
  let sourceAsset: AudioAsset | null = null;
  if (sourceResult.ok) {
    sourceAsset = sourceResult.value;
    if (sourceAsset.duration_ms > MAX_SOURCE_ASSET_MS) {
      pushIssue(issues, '$.source_asset.duration_ms', `source asset duration_ms must be at most ${MAX_SOURCE_ASSET_MS}`);
    }
  } else {
    appendNestedIssues(
      sourceResult.issues,
      '$.source_asset',
      'must satisfy the accepted audio-asset contract',
      issues,
    );
  }

  const inputResult = validateAudioAsset(record['input_asset']);
  let inputAsset: AudioAsset | null = null;
  if (inputResult.ok) {
    inputAsset = inputResult.value;
    if (inputAsset.duration_ms > MAX_INPUT_ASSET_MS) {
      pushIssue(issues, '$.input_asset.duration_ms', `input asset duration_ms must be at most ${MAX_INPUT_ASSET_MS}`);
    }
  } else {
    appendNestedIssues(
      inputResult.issues,
      '$.input_asset',
      'must satisfy the accepted audio-asset contract',
      issues,
    );
  }
  if (sourceAsset !== null && inputAsset !== null && sourceAsset.asset_id === inputAsset.asset_id) {
    pushIssue(issues, '$.input_asset.asset_id', 'source_asset and input_asset must be distinct assets');
  }

  // The annotation can only be validated once the analysis input asset exists;
  // an invalid input asset already fails this record.
  const annotationRaw = record['annotation'];
  let annotationAvailable = false;
  if (annotationRaw !== null && inputAsset !== null) {
    const annotationResult = validateAnnotatedAudio(annotationRaw, inputAsset);
    if (annotationResult.ok) {
      annotationAvailable = true;
    } else {
      appendNestedIssues(
        annotationResult.issues,
        '$.annotation',
        'must satisfy the accepted input-annotation contract for the analysis input asset',
        issues,
      );
    }
  }

  const draftRaw = record['reply_draft'];
  let draft: ReplyDraft | null = null;
  if (draftRaw !== null) {
    const draftResult = validateReplyDraft(draftRaw);
    if (draftResult.ok) {
      draft = draftResult.value;
    } else {
      appendNestedIssues(draftResult.issues, '$.reply_draft', 'must satisfy the accepted reply-draft contract', issues);
    }
  }

  const planRaw = record['reply_plan'];
  let plan: ReplyPlan | null = null;
  if (planRaw !== null) {
    const planResult = validateReplyPlan(planRaw);
    if (planResult.ok) {
      plan = planResult.value;
    } else {
      appendNestedIssues(planResult.issues, '$.reply_plan', 'must satisfy the accepted reply-plan contract', issues);
    }
    if (draftRaw === null) {
      pushIssue(issues, '$.reply_plan', 'reply_plan requires a reply_draft');
    } else if (draft !== null && plan !== null) {
      const planText = plan.segments.map((segment) => segment.text).join('');
      if (planText !== draft.reply_text) {
        pushIssue(issues, '$.reply_plan.segments', 'plan segment text must concatenate exactly to reply_draft.reply_text');
      }
    }
  }

  const outputRaw = record['output_asset'];
  const alignmentRaw = record['output_alignment'];
  let outputAsset: AudioAsset | null = null;
  if (outputRaw !== null) {
    if (draft === null || plan === null) {
      pushIssue(issues, '$.output_asset', 'output_asset requires a validated reply_draft and reply_plan');
    }
    if (draft !== null) {
      const wrapper: DataRecord = {
        asset: outputRaw,
        storage_key: VALIDATION_ONLY_STORAGE_KEY,
        alignment: alignmentRaw,
        applied_controls: record['applied_controls'],
        unsupported_controls: record['unsupported_controls'],
      };
      const speechResult = validateGeneratedSpeech(wrapper, draft.reply_text);
      if (speechResult.ok) {
        outputAsset = speechResult.value.asset;
      } else {
        appendGeneratedSpeechIssues(speechResult.issues, issues);
      }
    } else {
      const assetResult = validateAudioAsset(outputRaw);
      if (assetResult.ok) {
        outputAsset = assetResult.value;
      } else {
        appendNestedIssues(
          assetResult.issues,
          '$.output_asset',
          'must satisfy the accepted audio-asset contract',
          issues,
        );
      }
    }
    if (outputAsset !== null) {
      const existingIds: (string | null)[] = [
        sourceAsset === null ? null : sourceAsset.asset_id,
        inputAsset === null ? null : inputAsset.asset_id,
      ];
      if (existingIds.includes(outputAsset.asset_id)) {
        pushIssue(issues, '$.output_asset.asset_id', 'output_asset must be a third asset distinct from source_asset and input_asset');
      }
    }
  } else {
    if (alignmentRaw !== null) {
      pushIssue(issues, '$.output_alignment', 'output_alignment must be null when there is no output_asset');
    }
    checkEmptyControls(record['applied_controls'], '$.applied_controls', 'applied_controls', issues);
    checkEmptyControls(record['unsupported_controls'], '$.unsupported_controls', 'unsupported_controls', issues);
  }

  const playback = record['playback_completed'];
  if (typeof playback !== 'boolean') {
    pushIssue(issues, '$.playback_completed', 'playback_completed must be a boolean');
  } else if (playback && outputRaw === null) {
    pushIssue(issues, '$.playback_completed', 'playback_completed can only be true when output_asset is present');
  }

  const stageStatuses = new Map<string, string>();
  const stagesRaw = record['stages'];
  if (isPlainRecord(stagesRaw) === false) {
    pushIssue(issues, '$.stages', 'stages must be a plain object of stage outcomes');
  } else {
    for (const stageName of Object.keys(stagesRaw)) {
      const outcomePath = joinPath('$.stages', stageName);
      if (ROUND_STAGES.includes(stageName) === false) {
        pushIssue(issues, outcomePath, 'stage name is not part of the round contract');
        continue;
      }
      const outcome = stagesRaw[stageName];
      if (isPlainRecord(outcome) === false) {
        pushIssue(issues, outcomePath, 'stage outcome must be a plain object');
        continue;
      }
      for (const outcomeKey of Object.keys(outcome)) {
        if (STAGE_OUTCOME_KEYS.includes(outcomeKey) === false) {
          pushIssue(issues, joinPath(outcomePath, outcomeKey), 'unknown stage outcome field is not part of the contract');
        }
      }
      const status = outcome['status'];
      if (typeof status !== 'string' || STAGE_STATUS_VALUES.includes(status) === false) {
        pushIssue(issues, joinPath(outcomePath, 'status'), 'status must be "ok", "unavailable", "failed" or "skipped"');
      } else {
        stageStatuses.set(stageName, status);
      }
      if (Object.hasOwn(outcome, 'reason')) {
        checkNonblankReason(outcome['reason'], joinPath(outcomePath, 'reason'), 'stage reason', issues);
      }
    }
  }

  const failureRaw = record['failure'];
  if (failureRaw !== null) {
    if (isPlainRecord(failureRaw) === false) {
      pushIssue(issues, '$.failure', 'failure must be a plain object');
    } else {
      checkExactKeys(failureRaw, FAILURE_KEYS, '$.failure', issues);
      const code = failureRaw['code'];
      if (typeof code !== 'string' || ROUND_FAILURE_CODES.includes(code as RoundFailureCode) === false) {
        pushIssue(issues, '$.failure.code', 'code must be one of the stable round failure codes');
      }
      const failureStage = failureRaw['stage'];
      if (typeof failureStage !== 'string' || ROUND_STAGES.includes(failureStage) === false) {
        pushIssue(issues, '$.failure.stage', 'stage must be one of the round stage names');
      }
      checkNonblankReason(failureRaw['message'], '$.failure.message', 'failure message', issues);
      if (typeof failureRaw['retryable'] !== 'boolean') {
        pushIssue(issues, '$.failure.retryable', 'retryable must be a boolean');
      }
    }
  }

  if (stageStatuses.get('complete') === 'ok') {
    if (record['failure'] !== null) {
      pushIssue(issues, '$.failure', 'a completed round must not report a failure');
    }
    for (const stageName of PRIOR_STAGES) {
      const status = stageStatuses.get(stageName);
      if (status === undefined) {
        pushIssue(issues, joinPath('$.stages', stageName), 'a completed round requires this prior stage with status "ok"');
      } else if (status !== 'ok') {
        pushIssue(issues, joinPath('$.stages', stageName), 'a completed round requires every prior stage to have status "ok"');
      }
    }
    if (annotationAvailable === false) {
      pushIssue(issues, '$.annotation', 'a completed round requires a validated annotation');
    }
    if (draft === null) {
      pushIssue(issues, '$.reply_draft', 'a completed round requires a validated reply_draft');
    }
    if (plan === null) {
      pushIssue(issues, '$.reply_plan', 'a completed round requires a validated reply_plan');
    }
    if (outputAsset === null) {
      pushIssue(issues, '$.output_asset', 'a completed round requires a validated output_asset');
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as TurnRecord };
}
