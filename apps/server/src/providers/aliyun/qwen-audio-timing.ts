import type { AudioPublicationPort, RemoteAudioReference, StoredAudio, AnalysisFailure } from '../../application/analysis-ports.js';
import type { TimingPort, UntimedTranscription } from '../../application/input-stage-ports.js';
import { validateAnnotatedAudio, validateAudioAsset } from '../../domain/annotation.ts';
import type { AnnotatedAudio, AudioAsset, Observation, TimedUnit } from '../../domain/annotation.ts';
import { mapParaformerResult } from './filetrans-result.ts';

export const QWEN_AUDIO_TIMING_MODEL = 'qwen-audio-3.1-asr-flash-filetrans';
const SUBMIT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const TASKS = 'https://dashscope.aliyuncs.com/api/v1/tasks/';
const RESULT_HOST = 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com';
const MAX_TIMER = 2147483647;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MSG = {
 config: 'invalid Qwen audio timing configuration', input: 'invalid audio timing input',
 cancel: 'audio timing was cancelled by the caller', timeout: 'audio timing exceeded its time budget',
 publish: 'audio publication failed', model: 'published audio model does not match the selected timing model',
 submit: 'Qwen audio timing submission failed', provider: 'Qwen audio timing provider did not produce a result',
 result: 'Qwen audio timing result is invalid', timing: 'Qwen audio timing is unavailable',
 lexical: 'Qwen audio timing text does not match the reference transcript', unexpected: 'Qwen audio timing failed before producing a result',
};
type Code = AnalysisFailure['code'];
type SafeFailure = AnalysisFailure;
const trusted = new WeakSet<object>();
function fail(code: Code, message: string): SafeFailure {
 const e: SafeFailure = { code, stage: 'transcription', message, retryable: false }; trusted.add(e); return e;
}
const invalid = () => fail('invalid_result', MSG.result);
function safe(error: unknown, fallback: SafeFailure): SafeFailure { return typeof error === 'object' && error !== null && trusted.has(error) ? error as SafeFailure : fallback; }
function config(ok: boolean): void { if (!ok) throw new Error(MSG.config); }
type Deadline = { signal: AbortSignal; timedOut: () => boolean; dispose: () => void };
function deadline(caller: AbortSignal, ms: number): Deadline {
 const controller = new AbortController(); let timeout = false;
 const abort = () => controller.abort();
 if (caller.aborted) controller.abort(); else caller.addEventListener('abort', abort, { once: true });
 const timer = setTimeout(() => { timeout = true; controller.abort(); }, ms);
 return { signal: controller.signal, timedOut: () => timeout, dispose: () => { clearTimeout(timer); caller.removeEventListener('abort', abort); } };
}
function abortFailure(d: Deadline): SafeFailure { return d.timedOut() ? fail('timed_out', MSG.timeout) : fail('cancelled', MSG.cancel); }
function check(d: Deadline): void { if (d.signal.aborted) throw abortFailure(d); }
function race<T>(promise: Promise<T>, d: Deadline, late?: (value: T) => void): Promise<T> {
 if (d.signal.aborted) { promise.then(v => late?.(v), () => undefined); throw abortFailure(d); }
 return new Promise((resolve, reject) => {
  const onAbort = () => reject(abortFailure(d)); d.signal.addEventListener('abort', onAbort, { once: true });
  promise.then(v => { d.signal.removeEventListener('abort', onAbort); if (d.signal.aborted) { late?.(v); reject(abortFailure(d)); } else resolve(v); }, e => { d.signal.removeEventListener('abort', onAbort); reject(d.signal.aborted ? abortFailure(d) : e); });
 });
}
function release(response: Response): void { try { response.body?.cancel().catch(() => undefined); } catch {} }
function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void { try { void reader.cancel().catch(() => undefined); } catch {} }
function sleep(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { let settled = false; const finish = (error?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', aborted); error === undefined ? resolve() : reject(error); }; const aborted = () => finish(new Error('aborted')); const timer = setTimeout(() => finish(), ms); if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once:true }); }); }
async function readJson(response: Response, max: number, d: Deadline, failure: () => SafeFailure): Promise<unknown> {
 const len = response.headers.get('content-length');
 if (len !== null && (!/^[0-9]+$/.test(len) || !Number.isSafeInteger(Number(len)) || Number(len) > max)) { release(response); throw failure(); }
 if (!response.body) throw failure(); const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
 try { for (;;) { const part = await race(reader.read(), d); if (part.done) break; total += part.value.byteLength; if (total > max) throw failure(); chunks.push(part.value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure(); }
 } finally { try { void reader.cancel().catch(() => undefined); } catch {} try { reader.releaseLock(); } catch {} }
}
function record(v: unknown): Record<string, unknown> | null { if (typeof v !== 'object' || v === null || Array.isArray(v)) return null; const p = Object.getPrototypeOf(v); if (p !== Object.prototype && p !== null) return null; for (const k of Object.keys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d || d.get || d.set) return null; } return v as Record<string, unknown>; }
function resultUrl(v: unknown): string {
 if (typeof v !== 'string') throw invalid(); let u: URL; try { u = new URL(v); } catch { throw invalid(); }
 if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.hostname.toLowerCase() !== RESULT_HOST || u.username || u.password || u.port || u.hash) throw invalid();
 return u.protocol === 'http:' ? `https://${RESULT_HOST}${u.pathname}${u.search}` : v;
}
function isIgnoredCodePoint(c: string): boolean { return /^[\p{P}\p{White_Space}]$/u.test(c); }
function lexical(text: string): string { return Array.from(text).filter(c => !isIgnoredCodePoint(c)).join(''); }
type ValidReference = { reference: UntimedTranscription; contextText: string };
function validateReference(asset: AudioAsset, input: UntimedTranscription): ValidReference {
 const validAsset = validateAudioAsset(asset);
 if (!validAsset.ok || !record(input) || input.asset_id !== validAsset.value.asset_id || typeof input.transcript !== 'string' || input.transcript.length > 6000 || typeof input.source_provider !== 'string' || !input.source_provider.trim() || typeof input.source_model !== 'string' || !input.source_model.trim() || !Array.isArray(input.sound_events) || input.sound_events.length > 32) throw fail('invalid_audio', MSG.input);
 let reference: UntimedTranscription; try { reference = structuredClone(input); } catch { throw fail('invalid_audio', MSG.input); }
 if (reference.sound_events.some(e => !record(e) || e.kind !== 'sound_event' || typeof e.label !== 'string' || !e.label.trim() || e.label.length > 256)) throw fail('invalid_audio', MSG.input);
 const empty: AnnotatedAudio = { schema_version:'0.1', asset_id:validAsset.value.asset_id, transcript:'', segments:[], observations:reference.sound_events as Observation[], capabilities:{word_timing:{status:'unavailable',reason:'validation only'},emotion:{status:'unavailable',reason:'validation only'},prosody:{status:'unavailable',reason:'validation only'},sound_event:reference.sound_event_capability} };
 if (!validateAnnotatedAudio(empty, validAsset.value).ok) throw fail('invalid_audio', MSG.input);
 const contextText = JSON.stringify({ reference_transcript:reference.transcript, background_sounds:reference.sound_events.map(e => e.label) });
 if (Array.from(contextText).length > 400) throw invalid();
 return { reference, contextText };
}
function mapReference(mapped: AnnotatedAudio, asset: AudioAsset, reference: UntimedTranscription): AnnotatedAudio {
 const units = mapped.segments.flatMap(s => s.units ?? []);
 if (lexical(mapped.transcript) !== lexical(reference.transcript) || lexical(units.map(u => u.text).join('')) !== lexical(reference.transcript)) throw fail('invalid_result', MSG.lexical);
 if (reference.transcript.length === 0) {
  if (mapped.transcript !== '' || units.length !== 0) throw fail('invalid_result', MSG.lexical);
  mapped.transcript = ''; mapped.segments = []; mapped.observations = [];
  mapped.capabilities.word_timing = { status: 'ok', source_provider: 'aliyun', source_model: QWEN_AUDIO_TIMING_MODEL };
 } else {
  if (units.length === 0 || units.some(u => u.timing.status !== 'available')) throw fail('timing_unavailable', MSG.timing);
  const original = Array.from(reference.transcript); let cursor = 0; const mappedUnits: TimedUnit[] = [];
  for (const unit of units) {
   const chars = Array.from(unit.text).filter(c => !isIgnoredCodePoint(c)); if (!chars.length) throw invalid();
   let start = cursor; while (start < original.length && isIgnoredCodePoint(original[start])) start++;
   let end = start;
   for (const ch of chars) { while (end < original.length && isIgnoredCodePoint(original[end])) end++; if (original[end] !== ch) throw fail('invalid_result', MSG.lexical); end++; }
   while (end < original.length && isIgnoredCodePoint(original[end])) end++;
   const t = unit.timing; if (t.status !== 'available') throw fail('timing_unavailable', MSG.timing);
   mappedUnits.push({ text: original.slice(cursor, end).join(''), granularity: unit.granularity, timing: { status: 'available', start_ms: t.start_ms, end_ms: t.end_ms, source: `aliyun:${QWEN_AUDIO_TIMING_MODEL}:native_hint` } }); cursor = end;
  }
  while (cursor < original.length && isIgnoredCodePoint(original[cursor])) cursor++;
  if (cursor !== original.length || mappedUnits.map(u => u.text).join('') !== reference.transcript) throw fail('invalid_result', MSG.lexical);
  const first = mappedUnits[0].timing; const last = mappedUnits[mappedUnits.length - 1].timing;
  if (first.status !== 'available' || last.status !== 'available') throw fail('timing_unavailable', MSG.timing);
  mapped.transcript = reference.transcript;
  mapped.segments = [{ segment_id: 'timing-1', text: reference.transcript, timing: { status: 'available', start_ms: first.start_ms, end_ms: last.end_ms, source: `aliyun:${QWEN_AUDIO_TIMING_MODEL}:native_hint_envelope` }, units: mappedUnits }];
  mapped.observations = [];
  mapped.capabilities.word_timing = { status: 'ok', source_provider: 'aliyun', source_model: QWEN_AUDIO_TIMING_MODEL };
 }
 mapped.capabilities.emotion = { status: 'unavailable', reason: 'emotion is unavailable from this timing stage; use a separate emotion stage' };
 mapped.capabilities.prosody = { status: 'unavailable', reason: 'prosody is unavailable from Qwen audio timing' };
 mapped.capabilities.sound_event = reference.sound_event_capability as AnnotatedAudio['capabilities']['sound_event'];
 for (const o of reference.sound_events) mapped.observations.push(structuredClone(o) as Observation);
 const valid = validateAnnotatedAudio(mapped, asset); if (!valid.ok) throw invalid(); return valid.value;
}
/** Maps Qwen's filetrans-shaped native hint response; Paraformer mapper is reused solely for strict generic payload/timing validation, never for a provider call. */
export function mapQwenAudioTimingResult(raw: unknown, asset: AudioAsset, reference: UntimedTranscription): AnnotatedAudio {
 const validAsset = validateAudioAsset(asset); if (!validAsset.ok) throw fail('invalid_audio', MSG.input);
 const validatedReference = validateReference(validAsset.value, reference);
 const mapped = mapParaformerResult(raw, validAsset.value); if (!mapped.ok) throw mapped.error.code === 'timing_unavailable' ? fail('timing_unavailable', MSG.timing) : invalid();
 return mapReference(mapped.value, validAsset.value, validatedReference.reference);
}
type Options = { apiKey: string; publication: AudioPublicationPort; timeoutMs?: number; pollIntervalMs?: number; maxPolls?: number; fetch?: typeof fetch };
export class QwenAudioTiming implements TimingPort {
 readonly #key: string; readonly #publish: AudioPublicationPort['publish']; readonly #timeout: number; readonly #interval: number; readonly #polls: number; readonly #fetch: typeof fetch;
 constructor(options: Options) {
  const timeout = options.timeoutMs ?? 150000, interval = options.pollIntervalMs ?? 1000, polls = options.maxPolls ?? 100;
  config(options !== null && options !== undefined && typeof options.apiKey === 'string' && !!options.apiKey && !CONTROL.test(options.apiKey) && !!options.publication && typeof options.publication.publish === 'function' && Number.isFinite(timeout) && Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_TIMER && Number.isFinite(interval) && Number.isInteger(interval) && interval > 0 && interval <= MAX_TIMER && Number.isFinite(polls) && Number.isInteger(polls) && polls > 0 && polls <= 10000 && (options.fetch === undefined || typeof options.fetch === 'function'));
  this.#key = options.apiKey; this.#publish = options.publication.publish.bind(options.publication); this.#timeout = timeout; this.#interval = interval; this.#polls = polls; this.#fetch = options.fetch ?? globalThis.fetch;
 }
 async align(audio: StoredAudio, transcription: UntimedTranscription, options: { signal: AbortSignal }): Promise<AnnotatedAudio> {
  const d = deadline(options.signal, this.#timeout);
  try {
   const assetCheck = validateAudioAsset(audio?.asset); if (!assetCheck.ok || !record(audio) || typeof audio.storage_key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(audio.storage_key) || !record(transcription) || transcription.asset_id !== assetCheck.value.asset_id) throw fail('invalid_audio', MSG.input);
   const validatedReference = validateReference(assetCheck.value, transcription);
   let ref: UntimedTranscription; let stored: StoredAudio; try { ref = validatedReference.reference; stored = structuredClone(audio); } catch { throw fail('invalid_audio', MSG.input); }
   const contextText = validatedReference.contextText;
   check(d);
   let remote: RemoteAudioReference;
   try { remote = await race(this.#publish(stored, { model: QWEN_AUDIO_TIMING_MODEL, signal:d.signal }), d); } catch(e) { throw safe(e, fail('publication_failed', MSG.publish)); }
   if (!record(remote) || remote.model !== QWEN_AUDIO_TIMING_MODEL) throw fail('model_mismatch', MSG.model);
   if (typeof remote.uri !== 'string' || typeof remote.transport !== 'string' || (remote.transport !== 'https' && remote.transport !== 'oss-resource') || !(remote.expires_at_ms === null || (Number.isSafeInteger(remote.expires_at_ms) && remote.expires_at_ms > Date.now()))) throw fail('publication_failed', MSG.publish);
   if (remote.transport === 'oss-resource' ? !/^oss:\/\/[A-Za-z0-9._/-]+$/.test(remote.uri) || remote.uri.includes('..') : !safeOss(remote.uri)) throw fail('publication_failed', MSG.publish);
   check(d);
   const headers: Record<string,string> = { Authorization:`Bearer ${this.#key}`, 'Content-Type':'application/json', 'X-DashScope-Async':'enable' };
   if (remote.transport === 'oss-resource') headers['X-DashScope-OssResourceResolve'] = 'enable';
   const body = JSON.stringify({ model:QWEN_AUDIO_TIMING_MODEL, input:{file_urls:[remote.uri],context:[{role:'user',content:[{type:'input_text',text:contextText}]}]}, parameters:{channel_id:[0],keep_dialect:true} });
   const initial = await this.#request(SUBMIT,{method:'POST',headers,body,redirect:'error',signal:d.signal},d, 'submission_failed');
   const taskRoot = record(initial); const output = taskRoot && record(taskRoot.output); const task = output?.task_id; if (!output) throw fail('submission_failed', MSG.submit); if (typeof task !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(task)) throw fail('submission_failed', MSG.submit);
   let status = output?.task_status; let result: string | null = null;
   if (status === 'SUCCEEDED') result = getResult(output); else if (status !== 'PENDING' && status !== 'RUNNING') throw fail('submission_failed', MSG.submit);
   for (let i=0; result === null && i<this.#polls; i++) {
    await race(sleep(this.#interval,d.signal),d);
    const poll = await this.#request(TASKS+encodeURIComponent(task),{method:'GET',headers:{Authorization:`Bearer ${this.#key}`},redirect:'error',signal:d.signal},d,'provider_failed');
    const po = record(poll); const out = po && record(po.output); if (!out || out.task_id !== task) throw fail('invalid_result',MSG.result);
    status = out.task_status; if (status === 'SUCCEEDED') result=getResult(out); else if (status !== 'PENDING' && status !== 'RUNNING') throw fail('provider_failed',MSG.provider);
   }
   if (result === null) throw fail('timed_out',MSG.timeout);
   const raw = await this.#request(result,{method:'GET',redirect:'error',signal:d.signal},d,'invalid_result',2*1024*1024);
   check(d); return mapQwenAudioTimingResult(raw, assetCheck.value, ref);
  } catch(e) { throw safe(e, fail('provider_failed', MSG.unexpected)); } finally { d.dispose(); }
 }
 async #request(url:string, init:RequestInit, d:Deadline, code: 'submission_failed'|'provider_failed'|'invalid_result', max=65536):Promise<unknown> {
  let response:Response;
  try { response=await race(this.#fetch(url,init),d,release); } catch(e) { throw safe(e, fail(code, code==='submission_failed'?MSG.submit:code==='provider_failed'?MSG.provider:MSG.result)); }
  if(response.status!==200){release(response);throw fail(code,code==='submission_failed'?MSG.submit:code==='provider_failed'?MSG.provider:MSG.result);}
  try{return await readJson(response,max,d,()=>fail(code,code==='submission_failed'?MSG.submit:code==='provider_failed'?MSG.provider:MSG.result));}catch(e){throw safe(e,fail(code,MSG.result));}
 }
}
function safeOss(value:string):boolean { try { const u=new URL(value); return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&/^[a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(u.hostname); } catch{return false;} }
function getResult(output:Record<string,unknown>):string { const results=output.results; if(!Array.isArray(results)||results.length!==1) throw fail('invalid_result',MSG.result); const entry=record(results[0]); if(!entry||entry.subtask_status!=='SUCCEEDED') throw fail('provider_failed',MSG.provider); return resultUrl(entry.transcription_url); }