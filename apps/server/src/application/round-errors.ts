import type {
  RoundFailure,
  RoundFailureCode,
  RoundStage,
} from '../domain/conversation.ts';

/** Static, safe English descriptions. Never provider text, paths, keys or URLs. */
const SAFE_MESSAGES: Readonly<Record<RoundFailureCode, string>> = {
  invalid_input: 'The request could not be processed because its input was not valid.',
  busy: 'The system is currently busy. Please try again.',
  not_found: 'The requested resource could not be found.',
  provider_unavailable: 'The required service is currently unavailable.',
  cancelled: 'The round was cancelled.',
  timed_out: 'The round timed out before it could complete.',
  provider_failed: 'The round failed while being processed.',
  invalid_result: 'The round produced a result that could not be used.',
  storage_failed: 'The round could not be stored.',
};

/** Manual-retry eligibility only; never an automatic retry. */
const RETRYABLE_CODES: ReadonlySet<RoundFailureCode> = new Set<RoundFailureCode>([
  'busy',
  'timed_out',
  'provider_failed',
  'storage_failed',
]);

const VALID_STAGES: ReadonlySet<RoundStage> = new Set<RoundStage>([
  'intake',
  'analysis',
  'context',
  'dialogue',
  'expression',
  'synthesis',
  'storage',
  'complete',
]);

const DEFAULT_CODE: RoundFailureCode = 'provider_failed';
const DEFAULT_STAGE: RoundStage = 'intake';

type TrustedData = { code: RoundFailureCode; stage: RoundStage };

/** Only errors created by makeRoundError are recorded here; foreign objects are absent. */
const trustedByError = new WeakMap<Error, TrustedData>();

function isCode(value: unknown): value is RoundFailureCode {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, value);
}

function isStage(value: unknown): value is RoundStage {
  return typeof value === 'string' && VALID_STAGES.has(value as RoundStage);
}

function trustedCodeOf(value: unknown): RoundFailureCode | undefined {
  if (typeof value === 'object' && value !== null) {
    return trustedByError.get(value as Error)?.code;
  }
  return undefined;
}

function buildFailure(code: RoundFailureCode, stage: RoundStage): RoundFailure {
  return {
    code,
    stage,
    message: SAFE_MESSAGES[code],
    retryable: RETRYABLE_CODES.has(code),
  };
}

/**
 * Create an Error carrying trusted failure data for a safe round error. An unknown
 * runtime code or stage resolves to a safe default instead of an undefined message.
 */
export function makeRoundError(code: RoundFailureCode, stage: RoundStage): Error {
  const safeCode: RoundFailureCode = isCode(code) ? code : DEFAULT_CODE;
  const safeStage: RoundStage = isStage(stage) ? stage : DEFAULT_STAGE;
  const error = new Error(SAFE_MESSAGES[safeCode]);
  trustedByError.set(error, { code: safeCode, stage: safeStage });
  return error;
}

/**
 * Reduce any unknown thrown value to a safe RoundFailure. The caller's stage always
 * wins; only factory-owned errors may supply a known code, and every foreign object
 * (including accessors) is ignored in favour of provider_failed. An aborted signal
 * overrides the error: its reason yields timed_out only when that reason is a trusted
 * timed_out error, otherwise cancelled. Returns a fresh object, never factory metadata.
 */
export function toRoundFailure(
  error: unknown,
  stage: RoundStage,
  signal?: AbortSignal,
): RoundFailure {
  const safeStage: RoundStage = isStage(stage) ? stage : DEFAULT_STAGE;
  if (signal && signal.aborted) {
    const timedOut = trustedCodeOf(signal.reason) === 'timed_out';
    return buildFailure(timedOut ? 'timed_out' : 'cancelled', safeStage);
  }
  return buildFailure(trustedCodeOf(error) ?? DEFAULT_CODE, safeStage);
}
