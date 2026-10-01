// M02/D20 conditional calibration acceptance tests. Synthetic JSON + injected
// mock fetch only: offline, no real audio, no credentials, no live provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapFiletransResult, mapParaformerResult, inspectFiletransResult,
  FILETRANS_MODEL, PARAFORMER_MODEL,
} from '../../apps/server/src/providers/aliyun/filetrans-result.ts';
import { AlibabaFiletransAnalysis } from '../../apps/server/src/providers/aliyun/filetrans-analysis.ts';
import { AlibabaTemporaryPublication } from '../../apps/server/src/providers/aliyun/temporary-publication.ts';

const QWEN_TS = 'aliyun:' + FILETRANS_MODEL;
const CAL_TS = 'aliyun:' + PARAFORMER_MODEL + ':timestamp_alignment';
const ENV_TS = CAL_TS + ':unit-envelope';
const RESULT_HOST = 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com';
const SUBMIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const TASKS_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks/';
const UPLOAD_POLICY_URL = 'https://dashscope.aliyuncs.com/api/v1/uploads';
const NI = '\u4f60'; const HAO = '\u597d'; const ZAI = '\u518d'; const JIAN = '\u89c1'; const DOT = '\u3002';
const HELLO = NI + HAO + DOT;
const HELLOP = NI + HAO;
const BYE = ZAI + JIAN;
const HELLO_BYE = NI + HAO + ZAI + JIAN;
const ASSET = { asset_id: 'asset-1', media_type: 'audio/wav', duration_ms: 2000, sample_rate_hz: 16000, channels: 1 };
const W = (text, begin_time, end_time, extra) => Object.assign({ begin_time, end_time, text }, extra || {});
const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json' } });
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; };
const remote = (model) => ({ uri: 'oss://mutsumi-tmp/clip-1.wav', model, expires_at_ms: null, transport: 'oss-resource' });

const qwenHelloSoft = () => ({ transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
  begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral', words: [W(NI, 0, 0), W(HAO, 100, 900)] }] }] });
const qwenHelloValid = () => ({ transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
  begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral', words: [W(NI, 0, 400), W(HAO, 400, 900)] }] }] });
const paraformerHello = () => ({ transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
  begin_time: 10, end_time: 950, text: HELLO, words: [W(NI, 10, 200), W(HAO, 200, 950)] }] }] });
const baseCalibration = () => {
  const r = mapParaformerResult(paraformerHello(), ASSET);
  assert.equal(r.ok, true, 'paraformer calibration fixture must be valid');
  return clone(r.value);
};
const unit = (text, s, e, src, gran) => ({ text, granularity: gran || 'character', timing: { status: 'available', start_ms: s, end_ms: e, source: src } });

async function expectReject(promise, code, note) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, note + ': expected rejection ' + code);
  assert.equal(err.code, code, note + ': code');
  assert.equal(err.stage, 'transcription', note + ': stage');
  assert.equal(err.retryable, false, note + ': retryable');
  assert.ok(typeof err.message === 'string' && err.message.length > 0, note + ': message');
  return err;
}
const isSubmit = (u) => u === SUBMIT_URL;
const isPoll = (u) => u.startsWith(TASKS_URL);
const isDownload = (u) => !isSubmit(u) && !isPoll(u);
function makeFetch(respond) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  f.calls = calls;
  f.submitBody = () => JSON.parse(calls.find((c) => isSubmit(c.url)).init.body);
  f.count = (pred) => calls.filter((c) => pred(c.url)).length;
  return f;
}
function analysisOptions(fetch, extra) {
  const e = extra || {};
  return { apiKey: 'MOCK-KEY', timeoutMs: e.timeoutMs || 5000, pollIntervalMs: e.pollIntervalMs || 1,
    maxPolls: e.maxPolls || 4, maxResultBytes: 1024 * 1024, fetch,
    sleep: e.sleep === undefined ? (async () => {}) : e.sleep, model: e.model, timingCalibration: e.timingCalibration };
}
function qwenSucceededDownload(url, payload) {
  return (u) => {
    if (isSubmit(u)) return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', result: { transcription_url: url } } });
    if (isDownload(u)) return json(payload);
    return json({ output: { task_id: 't1', task_status: 'PENDING' } });
  };
}
const sigResultUrl = 'https://' + RESULT_HOST + '/r.json?Sig=X';

test('fusion copies calibration unit times/source and derives segment envelope', () => {
  const value = mapFiletransResult(qwenHelloSoft(), ASSET, baseCalibration());
  assert.equal(value.ok, true, 'expected fusion, got ' + JSON.stringify(value.error));
  const seg = value.value.segments[0];
  assert.equal(seg.segment_id, 'seg-0');
  assert.equal(seg.text, HELLO);
  assert.deepEqual(seg.timing, { status: 'available', start_ms: 10, end_ms: 950, source: ENV_TS });
  assert.deepEqual(seg.units, [unit(NI, 10, 200, CAL_TS), unit(HAO, 200, 950, CAL_TS)]);
  assert.deepEqual(value.value.observations, [{ observation_id: 'emotion-0', kind: 'emotion', label: 'neutral',
    timing: { status: 'available', start_ms: 0, end_ms: 1000, source: QWEN_TS },
    source_provider: 'aliyun', source_model: FILETRANS_MODEL, segment_ids: ['seg-0'] }]);
  const c = value.value.capabilities;
  assert.deepEqual(c.word_timing, { status: 'ok', source_provider: 'aliyun', source_model: PARAFORMER_MODEL });
  assert.deepEqual(c.emotion, { status: 'ok', source_provider: 'aliyun', source_model: FILETRANS_MODEL });
});

test('fusion rejects full and partial lexical mismatch', () => {
  const full = baseCalibration();
  full.segments[0].units = [unit(HELLOP, 10, 950, CAL_TS, 'word')];
  const r1 = mapFiletransResult(qwenHelloSoft(), ASSET, full);
  assert.equal(r1.ok, false); assert.equal(r1.error.code, 'invalid_result');
  const partial = baseCalibration();
  partial.segments[0].units = [partial.segments[0].units[0]];
  partial.segments[0].text = NI; partial.transcript = NI;
  const r2 = mapFiletransResult(qwenHelloSoft(), ASSET, partial);
  assert.equal(r2.ok, false); assert.equal(r2.error.code, 'invalid_result');
});

test('fusion rejects a grouped unit that would require splitting a Qwen word', () => {
  const cal = baseCalibration();
  cal.segments[0].units = [unit(HELLOP, 10, 950, CAL_TS, 'word')];
  const r = mapFiletransResult(qwenHelloSoft(), ASSET, cal);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'invalid_result');
});

test('fusion rejects an incompatible Qwen sentence boundary', () => {
  const two = { transcripts: [{ channel_id: 0, text: HELLOP, sentences: [
    { begin_time: 0, end_time: 1000, text: NI, emotion: 'neutral', words: [W(NI, 0, 0)] },
    { begin_time: 1200, end_time: 2000, text: HAO, emotion: 'neutral', words: [W(HAO, 1200, 1200)] }] }] };
  assert.equal(inspectFiletransResult(two, ASSET).needs_calibration, true, 'qwen side is eligible');
  const cal = baseCalibration();
  cal.segments = [{ segment_id: 'seg-0', text: HELLOP, timing: { status: 'available', start_ms: 10, end_ms: 950, source: CAL_TS }, units: [unit(HELLOP, 10, 950, CAL_TS, 'word')] }];
  cal.transcript = HELLOP;
  const r = mapFiletransResult(two, ASSET, cal);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'invalid_result');
});

test('fusion rejects wrong asset, model, source and zero/overlap/missing units', () => {
  const v = {};
  v['wrong asset'] = (() => { const c = baseCalibration(); c.asset_id = 'asset-2'; return c; })();
  v['wrong source model'] = (() => { const c = baseCalibration(); c.capabilities.word_timing.source_model = FILETRANS_MODEL; return c; })();
  v['wrong unit source'] = (() => { const c = baseCalibration(); c.segments[0].units[0].timing.source = QWEN_TS; return c; })();
  v['zero interval'] = (() => { const c = baseCalibration(); c.segments[0].units[0].timing.end_ms = c.segments[0].units[0].timing.start_ms; return c; })();
  v['overlap interval'] = (() => { const c = baseCalibration(); c.segments[0].units[1].timing.start_ms = 100; return c; })();
  v['absent units'] = (() => { const c = baseCalibration(); c.segments[0].units = []; return c; })();
  for (const k of Object.keys(v)) {
    const r = mapFiletransResult(qwenHelloSoft(), ASSET, v[k]);
    assert.equal(r.ok, false, k + ': expected rejection');
    assert.equal(r.error.code, 'invalid_result', k + ': code');
  }
});

test('Qwen lexical inconsistency is rejected before billing (inspect + map)', () => {
  const lexBad = { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
    begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral', words: [W(NI, 0, 0)] }] }] };
  const insp = inspectFiletransResult(lexBad, ASSET);
  assert.equal(insp.ok, false, 'must not be reported as calibratable');
  assert.equal(insp.error.code, 'invalid_result');
  const mapped = mapFiletransResult(lexBad, ASSET, baseCalibration());
  assert.equal(mapped.ok, false); assert.equal(mapped.error.code, 'invalid_result');
});

test('full scan rejects malformed fields appearing after a zero-length unit', () => {
  const raw = (words, sentence) => ({ transcripts: [{ channel_id: 0, text: HELLO, sentences: [Object.assign({
    begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral', words }, sentence)] }] });
  const cases = {
    'bad punctuation after zero': raw([W(NI, 0, 0), W(HAO, 100, 900, { punctuation: 5 })], {}),
    'bad emotion after zero': raw([W(NI, 0, 0)], { emotion: 7 }),
    'reversed bounds after zero': raw([W(NI, 0, 0), W(HAO, 900, 100)], {}),
    'endpoint outside parent while other missing': raw([W(NI, 0, 0), W(HAO, 1500, undefined)], {}),
  };
  for (const k of Object.keys(cases)) {
    assert.equal(inspectFiletransResult(cases[k], ASSET).ok, false, k + ': hard defect must block calibration');
    assert.equal(mapFiletransResult(cases[k], ASSET, baseCalibration()).error.code, 'invalid_result', k);
  }
});

test('missing/empty/absent-endpoint words qualify and use actual calibration units', () => {
  const absent = qwenHelloSoft(); delete absent.transcripts[0].sentences[0].words;
  const empty = qwenHelloSoft(); empty.transcripts[0].sentences[0].words = [];
  const missing = { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
    begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral', words: [W(NI, 0, undefined), W(HAO, 100, 900)] }] }] };
  for (const r of [absent, empty, missing]) {
    assert.equal(inspectFiletransResult(r, ASSET).needs_calibration, true);
    const mapped = mapFiletransResult(r, ASSET, baseCalibration());
    assert.equal(mapped.ok, true);
    assert.deepEqual(mapped.value.segments[0].units.map((u) => [u.text, u.timing.start_ms, u.timing.end_ms, u.timing.source]),
      [[NI, 10, 200, CAL_TS], [HAO, 200, 950, CAL_TS]]);
  }
});

test('valid native speech and silence ignore calibration without inspecting it', () => {
  let inspected = 0;
  const hostile = { get asset_id() { inspected += 1; return 'x'; }, get segments() { inspected += 1; return []; } };
  const speech = mapFiletransResult(qwenHelloValid(), ASSET, hostile);
  assert.equal(speech.ok, true);
  assert.deepEqual(speech.value.capabilities.word_timing, { status: 'ok', source_provider: 'aliyun', source_model: FILETRANS_MODEL });
  assert.equal(speech.value.segments[0].units[0].timing.source, QWEN_TS);
  const silence = mapFiletransResult({ transcripts: [{ channel_id: 0, text: '', sentences: [] }] }, ASSET, hostile);
  assert.equal(silence.ok, true); assert.deepEqual(silence.value.segments, []);
  assert.equal(inspected, 0, 'native path must never inspect the calibration argument');
});

test('fusion is frozen-safe and preserves NFC, astral codepoints and punctuation', () => {
  const ASTRAL = '\uD83D\uDE00'; const NFD = 'e\u0301'; const NFC = '\u00e9';
  const qwen = { transcripts: [{ channel_id: 0, text: HAO + NFD + ASTRAL + DOT, sentences: [{
    begin_time: 0, end_time: 1000, text: HAO + NFD + ASTRAL + DOT, emotion: 'neutral',
    words: [W(HAO, 0, 0), W(NFD, 100, 100), W(ASTRAL, 200, 200)] }] }] };
  const para = { transcripts: [{ channel_id: 0, text: HAO + NFC + ASTRAL, sentences: [{
    begin_time: 10, end_time: 400, text: HAO + NFC + ASTRAL, words: [W(HAO, 10, 60), W(NFC, 60, 120), W(ASTRAL, 120, 400)] }] }] };
  const cal = clone(mapParaformerResult(para, ASSET).value);
  deepFreeze(qwen); deepFreeze(cal);
  const before = JSON.stringify({ qwen, cal });
  const r = mapFiletransResult(qwen, ASSET, cal);
  assert.equal(r.ok, true, 'expected NFC/astral fusion, got ' + JSON.stringify(r.error));
  assert.deepEqual(r.value.segments[0].units.map((u) => u.text), [HAO, NFC, ASTRAL]);
  assert.deepEqual(r.value.segments[0].timing, { status: 'available', start_ms: 10, end_ms: 400, source: ENV_TS });
  assert.equal(JSON.stringify({ qwen, cal }), before, 'mapper must not mutate frozen inputs');
});

test('multi-sentence fusion groups units and preserves original emotion times', () => {
  const qwen = { transcripts: [{ channel_id: 0, text: HELLO_BYE, sentences: [
    { begin_time: 0, end_time: 1000, text: HELLOP, emotion: 'neutral', words: [W(NI, 0, 0), W(HAO, 100, 100)] },
    { begin_time: 1200, end_time: 2000, text: BYE, emotion: 'sad', words: [W(ZAI, 1200, 1200), W(JIAN, 1300, 1300)] }] }] };
  const para = { transcripts: [{ channel_id: 0, text: HELLO_BYE, sentences: [
    { begin_time: 10, end_time: 900, text: HELLOP, words: [W(NI, 10, 200), W(HAO, 200, 900)] },
    { begin_time: 1100, end_time: 1900, text: BYE, words: [W(ZAI, 1100, 1400), W(JIAN, 1400, 1900)] }] }] };
  const cal = clone(mapParaformerResult(para, ASSET).value);
  const r = mapFiletransResult(qwen, ASSET, cal);
  assert.equal(r.ok, true, 'expected multi fusion, got ' + JSON.stringify(r.error));
  const s = r.value.segments;
  assert.deepEqual(s[0].timing, { status: 'available', start_ms: 10, end_ms: 900, source: ENV_TS });
  assert.deepEqual(s[1].timing, { status: 'available', start_ms: 1100, end_ms: 1900, source: ENV_TS });
  assert.deepEqual(r.value.observations.map((o) => [o.label, o.timing.start_ms, o.timing.end_ms, o.timing.source]),
    [['neutral', 0, 1000, QWEN_TS], ['sad', 1200, 2000, QWEN_TS]]);
});

test('native timing and silence call the calibration port zero times', async () => {
  const mk = (payload) => { const cals = []; const cal = { calibrate: (a, o) => { cals.push({ a, o }); return Promise.resolve(baseCalibration()); } };
    const fetch = makeFetch(qwenSucceededDownload(sigResultUrl, payload));
    return { fetch, cals, adapter: new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: cal })) }; };
  await mk(qwenHelloValid()).adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }).then((a) => a);
  const a = mk(qwenHelloValid()); await a.adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal });
  assert.equal(a.cals.length, 0, 'valid timing must not calibrate');
  const b = mk({ transcripts: [{ channel_id: 0, text: '', sentences: [] }] }); await b.adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal });
  assert.equal(b.cals.length, 0, 'silence must not calibrate');
});

test('each eligible defect calls calibration exactly once with same asset and signal, submit stays 1', async () => {
  const absentWords = qwenHelloSoft(); delete absentWords.transcripts[0].sentences[0].words;
  const emptyWords = qwenHelloSoft(); emptyWords.transcripts[0].sentences[0].words = [];
  const missingEndpoint = { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{
    begin_time: 0, end_time: 1000, text: HELLO, emotion: 'neutral',
    words: [W(NI, 0, undefined), W(HAO, 100, 900)] }] }] };
  const defects = { 'zero-length': qwenHelloSoft(), 'words absent': absentWords, 'words empty': emptyWords, 'endpoint missing': missingEndpoint };
  for (const [name, payload] of Object.entries(defects)) {
    const cals = [];
    const cal = { calibrate: (a, o) => { cals.push({ a, o }); return Promise.resolve(baseCalibration()); } };
    const fetch = makeFetch(qwenSucceededDownload(sigResultUrl, payload));
    const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: cal }));
    const value = await adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal });
    assert.equal(cals.length, 1, name + ': exactly one calibration call');
    assert.equal(cals[0].a, ASSET, name + ': same asset object');
    assert.ok(cals[0].o.signal instanceof AbortSignal, name + ': combined signal propagated');
    assert.equal(fetch.count(isSubmit), 1, name + ': exactly one billed submit');
    assert.equal(value.segments[0].units[0].timing.source, CAL_TS, name + ': fused');
  }
});

test('hard defects and unrelated HTTP errors never call calibration and never re-submit', async () => {
  const bad = {
    'negative': { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{ begin_time: -1, end_time: 1000, text: HELLO, words: [W(NI, 0, 0)] }] }] },
    'reversed': { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{ begin_time: 900, end_time: 400, text: HELLO, words: [W(NI, 0, 0)] }] }] },
    'fractional': { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{ begin_time: 0.5, end_time: 1000, text: HELLO, words: [W(NI, 0, 0)] }] }] },
    'out of clip': { transcripts: [{ channel_id: 0, text: HELLO, sentences: [{ begin_time: 0, end_time: 5000, text: HELLO, words: [W(NI, 0, 0)] }] }] },
    'malformed': { transcripts: [{ channel_id: 0, text: HELLO, sentences: {} }] },
  };
  for (const k of Object.keys(bad)) {
    let called = 0;
    const cal = { calibrate: () => { called += 1; return Promise.resolve(baseCalibration()); } };
    const fetch = makeFetch(qwenSucceededDownload(sigResultUrl, bad[k]));
    const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: cal }));
    await expectReject(adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'invalid_result', k);
    assert.equal(called, 0, k + ': no calibration');
    assert.equal(fetch.count(isSubmit), 1, k + ': one submit');
  }
  let httpCalled = 0;
  const cal = { calibrate: () => { httpCalled += 1; return Promise.resolve(baseCalibration()); } };
  const fetch = makeFetch((u) => (isSubmit(u)
    ? json({ output: { task_id: 't1', task_status: 'SUCCEEDED', result: { transcription_url: 'https://' + RESULT_HOST + '/r.json' } } })
    : new Response('', { status: 503 })));
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: cal }));
  await expectReject(adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'invalid_result', 'http error');
  assert.equal(httpCalled, 0); assert.equal(fetch.count(isSubmit), 1);
});

test('no configured port preserves strict safe errors (missing timing to timing_unavailable)', async () => {
  const fetchZero = makeFetch(qwenSucceededDownload(sigResultUrl, qwenHelloSoft()));
  const adapterZero = new AlibabaFiletransAnalysis(analysisOptions(fetchZero));
  await expectReject(adapterZero.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'invalid_result', 'no port: zero-boundary');
  assert.equal(fetchZero.count(isSubmit), 1);
  const absent = qwenHelloSoft(); delete absent.transcripts[0].sentences[0].words;
  const fetchAbsent = makeFetch(qwenSucceededDownload(sigResultUrl, absent));
  const adapterAbsent = new AlibabaFiletransAnalysis(analysisOptions(fetchAbsent));
  await expectReject(adapterAbsent.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'timing_unavailable', 'no port: words-absent');
  assert.equal(fetchAbsent.count(isSubmit), 1);
});

test('configuration rejects unknown model, malformed port and a port on Paraformer', () => {
  assert.throws(() => new AlibabaFiletransAnalysis(analysisOptions(globalThis.fetch, { model: 'whisper-large' })), /configuration/);
  assert.throws(() => new AlibabaFiletransAnalysis(analysisOptions(globalThis.fetch, { timingCalibration: {} })), /configuration/);
  assert.throws(() => new AlibabaFiletransAnalysis(analysisOptions(globalThis.fetch, { timingCalibration: () => {} })), /configuration/);
  assert.throws(() => new AlibabaFiletransAnalysis(analysisOptions(globalThis.fetch, { model: PARAFORMER_MODEL, timingCalibration: { calibrate: () => {} } })), /configuration/);
});

test('a bound class-method calibration port keeps this-binding and survives later mutation', async () => {
  class CalPort { constructor() { this.invoked = 0; } calibrate() { this.invoked += 1; return Promise.resolve(baseCalibration()); } }
  const port = new CalPort();
  const fetch = makeFetch(qwenSucceededDownload(sigResultUrl, qwenHelloSoft()));
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: port }));
  port.calibrate = async () => { throw new Error('MUTATED-MUST-NOT-RUN'); };
  const value = await adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal });
  assert.equal(value.segments[0].units[0].timing.source, CAL_TS);
  assert.equal(port.invoked, 1, 'captured bound method ran with this === port');
});

test('calibration ignoring signal yields timed_out; caller abort yields cancelled', async () => {
  let calls = 0;
  const hang = { calibrate: () => { calls += 1; return new Promise(() => {}); } };
  const fetchT = makeFetch(qwenSucceededDownload('https://' + RESULT_HOST + '/r.json', qwenHelloSoft()));
  const adapterT = new AlibabaFiletransAnalysis(analysisOptions(fetchT, { timeoutMs: 40, timingCalibration: hang }));
  await expectReject(adapterT.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'timed_out', 'hung calibration');
  assert.equal(calls, 1, 'calibration called exactly once before timeout');
  assert.equal(fetchT.count(isSubmit), 1, 'timeout case: exactly one submit');
  const controller = new AbortController();
  const abortCal = { calibrate: () => { controller.abort(); return new Promise(() => {}); } };
  const fetchC = makeFetch(qwenSucceededDownload('https://' + RESULT_HOST + '/r.json', qwenHelloSoft()));
  const adapterC = new AlibabaFiletransAnalysis(analysisOptions(fetchC, { timingCalibration: abortCal }));
  await expectReject(adapterC.analyze(ASSET, remote(FILETRANS_MODEL), { signal: controller.signal }), 'cancelled', 'caller abort');
  assert.equal(fetchC.count(isSubmit), 1, 'abort case: exactly one submit');
});

test('a foreign thrown object cannot masquerade as cancelled or leak its getters', async () => {
  const reads = { code: 0, message: 0, cause: 0 };
  const foreign = {
    get code() { reads.code += 1; return 'cancelled'; },
    get message() { reads.message += 1; return 'PRIVATE-SENTINEL'; },
    get cause() { reads.cause += 1; return { detail: 'PRIVATE-SENTINEL' }; },
  };
  let calCalls = 0;
  const cal = { calibrate: () => { calCalls += 1; return Promise.reject(foreign); } };
  const fetch = makeFetch(qwenSucceededDownload(sigResultUrl, qwenHelloSoft()));
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { timingCalibration: cal }));
  const err = await expectReject(adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'invalid_result', 'foreign throw via calibration');
  assert.equal(reads.code, 0, 'code getter never read');
  assert.equal(reads.message, 0, 'message getter never read');
  assert.equal(reads.cause, 0, 'cause getter never read');
  assert.ok(!err.message.includes('PRIVATE-SENTINEL'), 'no sentinel leak');
  assert.equal(calCalls, 1, 'calibration called exactly once');
  assert.equal(fetch.count(isSubmit), 1, 'exactly one submit');
});

const sub = (status) => ({ subtask_status: status, transcription_url: 'https://' + RESULT_HOST + '/r.json?Signature=SIG&Expires=1' });
function paraFetch(cfg) {
  return makeFetch((u) => {
    if (isSubmit(u)) {
      if (cfg.child === 'missing') return json({ output: { task_id: 't1', task_status: 'SUCCEEDED' } });
      if (cfg.child === 'multiple') return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [sub('SUCCEEDED'), sub('SUCCEEDED')] } });
      if (cfg.child === 'running') return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [sub('RUNNING')] } });
      if (cfg.immediate) return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [sub(cfg.child || 'SUCCEEDED')] } });
      return json({ output: { task_id: 't1', task_status: 'PENDING' } });
    }
    if (isPoll(u)) return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [sub(cfg.child || 'SUCCEEDED')] } });
    return cfg.httpError ? new Response('', { status: 500 }) : json(paraformerHello());
  });
}

test('Paraformer: exact submit payload, POST poll, HTTPS result GET without Authorization', async () => {
  const fetch = paraFetch({});
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { model: PARAFORMER_MODEL }));
  const value = await adapter.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal });
  const body = fetch.submitBody();
  assert.equal(body.model, PARAFORMER_MODEL);
  assert.deepEqual(body.input.file_urls, [remote(PARAFORMER_MODEL).uri]);
  assert.equal(body.parameters.timestamp_alignment_enabled, true);
  assert.equal(fetch.count(isPoll), 1, 'paraformer polls');
  assert.equal(fetch.calls.find((c) => isPoll(c.url)).init.method, 'POST', 'paraformer poll uses POST');
  const dl = fetch.calls.find((c) => isDownload(c.url));
  assert.equal(dl.init.method, 'GET'); assert.equal(dl.init.redirect, 'error');
  assert.ok(!(dl.init.headers && Object.keys(dl.init.headers).some((k) => k.toLowerCase() === 'authorization')), 'no Authorization on result GET');
  assert.equal(value.capabilities.word_timing.source_model, PARAFORMER_MODEL);
  assert.equal(value.capabilities.emotion.status, 'unavailable');
});

test('Paraformer: immediate SUCCEEDED with valid child maps timing (emotion unavailable)', async () => {
  const fetch = paraFetch({ immediate: true });
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { model: PARAFORMER_MODEL }));
  const value = await adapter.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal });
  assert.equal(value.segments[0].units[0].timing.source, CAL_TS);
  assert.equal(value.capabilities.emotion.status, 'unavailable');
});

test('Paraformer: failed child fails provider_failed even when parent SUCCEEDED', async () => {
  const immediate = paraFetch({ immediate: true, child: 'FAILED' });
  const a = new AlibabaFiletransAnalysis(analysisOptions(immediate, { model: PARAFORMER_MODEL }));
  await expectReject(a.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal }), 'provider_failed', 'immediate failed child');
  assert.equal(immediate.count(isDownload), 0, 'no download on failed child');
  const polled = paraFetch({ child: 'FAILED' });
  const b = new AlibabaFiletransAnalysis(analysisOptions(polled, { model: PARAFORMER_MODEL }));
  await expectReject(b.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal }), 'provider_failed', 'polled failed child');
});

test('Paraformer: missing/multiple/running child fails invalid_result without download or second submit', async () => {
  for (const child of ['missing', 'multiple', 'running']) {
    const fetch = paraFetch({ immediate: true, child });
    const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { model: PARAFORMER_MODEL }));
    await expectReject(adapter.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal }), 'invalid_result', child);
    assert.equal(fetch.count(isDownload), 0, child + ': no download');
    assert.equal(fetch.count(isSubmit), 1, child + ': single submit');
  }
});

test('Paraformer: model mismatch blocks network; signed http result is upgraded to https', async () => {
  const fetch = paraFetch({ immediate: true });
  const adapter = new AlibabaFiletransAnalysis(analysisOptions(fetch, { model: PARAFORMER_MODEL }));
  await expectReject(adapter.analyze(ASSET, remote(FILETRANS_MODEL), { signal: new AbortController().signal }), 'model_mismatch', 'mismatch');
  assert.equal(fetch.calls.length, 0, 'no network before model check');
  const fetch2 = makeFetch((u) => {
    if (isSubmit(u)) return json({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'http://' + RESULT_HOST + '/r.json?Signature=SIG&Expires=1' }] } });
    return json(paraformerHello());
  });
  const adapter2 = new AlibabaFiletransAnalysis(analysisOptions(fetch2, { model: PARAFORMER_MODEL }));
  await adapter2.analyze(ASSET, remote(PARAFORMER_MODEL), { signal: new AbortController().signal });
  const dl = fetch2.calls.find((c) => isDownload(c.url));
  assert.ok(dl.url.startsWith('https://' + RESULT_HOST), 'upgraded to https');
  assert.ok(dl.url.includes('Signature=SIG&Expires=1'), 'signed query preserved');
});

const SYNTHETIC_POLICY = () => ({ data: {
  policy: 'mock-policy', signature: 'mock-signature', oss_access_key_id: 'MOCKACCESSKEY',
  upload_dir: 'mutsumi/tmp', upload_host: 'https://mock.oss-cn-beijing.aliyuncs.com',
  expire_in_seconds: 300, max_file_size_mb: 10, x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } });
const storedAudio = () => ({ asset: { asset_id: 'asset-1', media_type: 'audio/wav', duration_ms: 2000, sample_rate_hz: 16000, channels: 1 }, storage_key: 'clip-1' });
function pubFetch() {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init });
    if (url.startsWith(UPLOAD_POLICY_URL)) return json(SYNTHETIC_POLICY());
    return new Response(null, { status: 200 }); };
  f.calls = calls; return f;
}
function pubOptions(fetch, readAudio) {
  return { apiKey: 'MOCK-PUB-KEY', readAudio, maxBytes: 5 * 1024 * 1024, timeoutMs: 3000, fetch, now: () => 1000000000000, objectId: () => 'obj1' };
}
const wavBlob = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });

test('publication binds the approved model into the policy query and the reference', async () => {
  for (const model of [FILETRANS_MODEL, PARAFORMER_MODEL]) {
    const fetch = pubFetch();
    const pub = new AlibabaTemporaryPublication(pubOptions(fetch, async () => wavBlob()));
    const ref = await pub.publish(storedAudio(), { model, signal: new AbortController().signal });
    assert.ok(fetch.calls[0].url.includes('model=' + encodeURIComponent(model)), model + ': policy query carries model');
    assert.equal(ref.model, model, model + ': reference model');
    assert.equal(ref.transport, 'oss-resource');
    assert.ok(ref.uri.startsWith('oss://'));
  }
});

test('publication blocks an unsupported model before any local read or network call', async () => {
  let read = 0;
  const fetch = pubFetch();
  const pub = new AlibabaTemporaryPublication(pubOptions(fetch, async () => { read += 1; return wavBlob(); }));
  let err = null;
  try { await pub.publish(storedAudio(), { model: 'whisper', signal: new AbortController().signal }); } catch (e) { err = e; }
  assert.equal(err.code, 'model_mismatch');
  assert.equal(read, 0, 'no local read');
  assert.equal(fetch.calls.length, 0, 'no network');
});

test('publication captures the model once and preserves it across async read mutation', async () => {
  const fetch = pubFetch();
  const options = { model: FILETRANS_MODEL, signal: new AbortController().signal };
  const pub = new AlibabaTemporaryPublication(pubOptions(fetch, () => new Promise((res) => setTimeout(() => res(wavBlob()), 1))));
  const p = pub.publish(storedAudio(), options);
  options.model = 'attacker-model';
  const ref = await p;
  assert.equal(ref.model, FILETRANS_MODEL, 'captured model preserved');
  assert.ok(fetch.calls[0].url.includes('model=' + encodeURIComponent(FILETRANS_MODEL)), 'policy query used captured model');
});

test('publication upload posts file last with no API Authorization', async () => {
  const fetch = pubFetch();
  const pub = new AlibabaTemporaryPublication(pubOptions(fetch, async () => wavBlob()));
  await pub.publish(storedAudio(), { model: FILETRANS_MODEL, signal: new AbortController().signal });
  const upload = fetch.calls.find((c) => !c.url.startsWith(UPLOAD_POLICY_URL));
  const keys = [...upload.init.body.keys()];
  assert.equal(keys[keys.length - 1], 'file', 'file must be the last multipart field');
  const headers = upload.init.headers || {};
  assert.ok(!Object.keys(headers).some((k) => k.toLowerCase() === 'authorization'), 'no Authorization header on upload');
});
