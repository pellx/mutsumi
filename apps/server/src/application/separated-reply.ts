/** Separate bounded reply text generation from required independent expression decision. */
import type { AudioAsset, AnnotatedAudio } from '../domain/annotation.ts';
import type { DialogueContext, HistoryTurn, OwnerPreference, Persona, ReplyDraft, ReplyExpressionSegment, RoundFailure } from '../domain/conversation.ts';
import { validateReplyDraft } from '../domain/conversation-validation.ts';
import { buildDialogueContext } from './dialogue-context.ts';
import { makeRoundError, toRoundFailure } from './round-errors.ts';

/** Text returned by the independently injected dialogue provider. */
export type TextReply = { reply_text: string; source_provider: string; source_model: string };
/** Expression is a target plan only; it carries no measured timing. */
export type ReplyEmotion =
  | { status: 'ok'; source_provider: string; source_model: string; segments: ReplyExpressionSegment[] }
  | { status: 'unknown' | 'unavailable'; source_provider: string; source_model: string };
/** Provider port for generating reply text. */
export type TextReplyPort = { generate(context: DialogueContext, options: { signal: AbortSignal }): Promise<TextReply> };
/** Provider port for deciding an expression for already generated text. */
export type ReplyEmotionPort = { decide(input: { reply_text: string; context: DialogueContext }, options: { signal: AbortSignal }): Promise<ReplyEmotion> };
/** Input is exactly the bounded dialogue-context builder input. */
export type SeparatedReplyInput = { asset: AudioAsset; annotation: AnnotatedAudio; persona: Persona; preferences: OwnerPreference[]; history: HistoryTurn[] };
export type SeparatedReplyResult = {
  text: TextReply | null;
  emotion: ReplyEmotion | null;
  stages: { text: 'ok' | 'failed'; emotion: 'ok' | 'unknown' | 'unavailable' | 'failed' | 'skipped' };
  failure: RoundFailure | null;
};

function invalid(stage: 'context' | 'dialogue' | 'expression'): Error { return makeRoundError('invalid_result', stage); }
function record(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || names.some(k => !keys.includes(k))) return null;
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) return null;
  }
  return value as Record<string, unknown>;
}
function source(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function validateText(value: unknown): TextReply {
  const r = record(value, ['reply_text', 'source_provider', 'source_model']);
  if (!r || typeof r.reply_text !== 'string' || r.reply_text.length === 0 || r.reply_text.trim().length === 0 || r.reply_text.length > 6000 || !source(r.source_provider) || !source(r.source_model)) throw invalid('dialogue');
  return { reply_text: r.reply_text, source_provider: r.source_provider, source_model: r.source_model };
}
function validateEmotion(value: unknown, replyText: string): ReplyEmotion {
  const base = record(value, ['status', 'source_provider', 'source_model']);
  if (base) {
    if ((base.status !== 'unknown' && base.status !== 'unavailable') || !source(base.source_provider) || !source(base.source_model)) throw invalid('expression');
    return { status: base.status, source_provider: base.source_provider, source_model: base.source_model };
  }
  const r = record(value, ['status', 'source_provider', 'source_model', 'segments']);
  if (!r || r.status !== 'ok' || !source(r.source_provider) || !source(r.source_model)) throw invalid('expression');
  const checked = validateReplyDraft({ reply_text: replyText, segments: r.segments });
  if (!checked.ok) throw invalid('expression');
  return { status: 'ok', source_provider: r.source_provider, source_model: r.source_model, segments: structuredClone(checked.value.segments) };
}
function makeGate(external: AbortSignal, deadlineMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(external.reason);
  if (external.aborted) onAbort();
  else external.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(makeRoundError('timed_out', 'dialogue')), deadlineMs);
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); external.removeEventListener('abort', onAbort); } };
}
function abortedError(signal: AbortSignal, stage: 'dialogue' | 'expression'): Error {
  return makeRoundError(toRoundFailure(signal.reason, stage, signal).code, stage);
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal, stage: 'dialogue' | 'expression'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; signal.removeEventListener('abort', onAbort); fn(); };
    const onAbort = () => finish(() => reject(makeRoundError(signal.reason instanceof Error && toRoundFailure(signal.reason, stage).code === 'timed_out' ? 'timed_out' : 'cancelled', stage)));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(makeRoundError(toRoundFailure(error, stage, signal).code, stage))));
    if (signal.aborted) onAbort();
  });
}

/** Generate text first, then request an expression for that immutable text/context. */
export async function generateSeparatedReply(
  input: SeparatedReplyInput,
  deps: { text: TextReplyPort; emotion: ReplyEmotionPort },
  options: { signal: AbortSignal; deadlineMs?: number },
): Promise<SeparatedReplyResult> {
  const context = buildDialogueContext(input);
  const deadline = options?.deadlineMs ?? 60000;
  if (!options || !(options.signal instanceof AbortSignal) || !Number.isInteger(deadline) || deadline < 1 || deadline > 120000 || !deps || typeof deps.text?.generate !== 'function' || typeof deps.emotion?.decide !== 'function') throw invalid('context');
  const gate = makeGate(options.signal, deadline);
  let stage: 'dialogue' | 'expression' = 'dialogue';
  try {
    if (gate.signal.aborted) return { text: null, emotion: null, stages: { text: 'failed', emotion: 'skipped' }, failure: toRoundFailure(gate.signal.reason, 'dialogue', gate.signal) };
    let rawText: unknown;
    try { rawText = await bounded(Promise.resolve().then(() => { if (gate.signal.aborted) throw abortedError(gate.signal, 'dialogue'); return deps.text.generate(structuredClone(context), { signal: gate.signal }); }), gate.signal, 'dialogue'); }
    catch (error) { return { text: null, emotion: null, stages: { text: 'failed', emotion: 'skipped' }, failure: toRoundFailure(error, 'dialogue', gate.signal) }; }
    let text: TextReply;
    try { text = validateText(rawText); } catch (error) { return { text: null, emotion: null, stages: { text: 'failed', emotion: 'skipped' }, failure: toRoundFailure(error, 'dialogue') }; }
    stage = 'expression';
    if (gate.signal.aborted) return { text: structuredClone(text), emotion: null, stages: { text: 'ok', emotion: 'failed' }, failure: toRoundFailure(gate.signal.reason, stage, gate.signal) };
    const emotionInput = { reply_text: text.reply_text, context: structuredClone(context) };
    let rawEmotion: unknown;
    try { rawEmotion = await bounded(Promise.resolve().then(() => { if (gate.signal.aborted) throw abortedError(gate.signal, 'expression'); return deps.emotion.decide(structuredClone(emotionInput), { signal: gate.signal }); }), gate.signal, 'expression'); }
    catch (error) { return { text: structuredClone(text), emotion: null, stages: { text: 'ok', emotion: 'failed' }, failure: toRoundFailure(error, 'expression', gate.signal) }; }
    try {
      const emotion = validateEmotion(rawEmotion, text.reply_text);
      return { text: structuredClone(text), emotion: structuredClone(emotion), stages: { text: 'ok', emotion: emotion.status }, failure: null };
    } catch (error) { return { text: structuredClone(text), emotion: null, stages: { text: 'ok', emotion: 'failed' }, failure: toRoundFailure(error, 'expression') }; }
  } finally { gate.cleanup(); }
}