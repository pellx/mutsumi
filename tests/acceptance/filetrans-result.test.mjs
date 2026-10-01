// M02b independent acceptance tests for the qwen3-asr-flash-filetrans result
// mapper. Synthetic JSON only: no real audio, credentials, provider calls or ASR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFiletransResult, FILETRANS_MODEL } from '../../apps/server/src/providers/aliyun/filetrans-result.ts';
const SOURCE = `aliyun:${FILETRANS_MODEL}`;
const ASSET = { asset_id: 'asset-1', media_type: 'audio/wav', duration_ms: 4000, sample_rate_hz: 16000, channels: 1 };
const BAD_ASSET = { asset_id: '', media_type: 'video/mp4', duration_ms: -1, sample_rate_hz: null, channels: null };
const ERROR_KEYS = ['code', 'message', 'retryable', 'stage'];
const W = (text, begin_time, end_time, extra = {}) => ({ begin_time, end_time, text, ...extra });
const S = (extra = {}) => ({ begin_time: 0, end_time: 1000, text: '你好。', words: [W('你', 0, 400), W('好', 400, 900)], ...extra });
const R = (extra = {}) => ({ transcripts: [{ channel_id: 0, text: '你好。', sentences: [S()], ...extra }] });
const drop = (o, k) => { const copy = { ...o }; delete copy[k]; return copy; };
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; };
const fill = (n, item) => { const a = new Array(n); a.fill(item); return a; };
const t0 = (sentences) => ({ channel_id: 0, text: '你好。', sentences });
const success = (raw, asset = ASSET) => {
  const r = mapFiletransResult(raw, asset);
  assert.equal(r.ok, true, `expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const failure = (raw, code, note, asset = ASSET) => {
  const r = mapFiletransResult(raw, asset);
  assert.equal(r.ok, false, `${note}: expected ${code}, got success`);
  const e = r.error;
  assert.equal(e.code, code, `${note}: code`);
  assert.equal(e.stage, 'transcription', `${note}: stage`);
  assert.equal(e.retryable, false, `${note}: retryable`);
  assert.ok(typeof e.message === 'string' && e.message.length > 0, `${note}: message`);
  assert.deepEqual(Object.keys(e).sort(), ERROR_KEYS, `${note}: error keys`);
  return e;
};
// Two sentences: character units, one multi-character word, overlapping word times, a gap, punctuation, vendor extras.
const FEATURE_RAW = () => ({
  transcripts: [{
    channel_id: 0, text: '今天有点， 累了。', vendor_request_id: 'req-1',
    sentences: [
      { begin_time: 0, end_time: 1200, text: '今天有点，', emotion: 'tired', id: 7,
        words: [W('今天', 0, 600), W('有', 600, 700), W('点', 650, 1200, { punctuation: '，', weight: 0.9 })] },
      { begin_time: 1400, end_time: 3900, text: '累了。', emotion: 'unknown-mood-x',
        words: [W('累', 1400, 3000), W('了', 3000, 3900, { punctuation: '。' })] },
    ],
  }],
});
test('valid Chinese result: transcript, segments, units, provenance and stable ids', () => {
  const input = FEATURE_RAW();
  const before = JSON.stringify(input);
  const value = success(input);
  assert.equal(value.schema_version, '0.1');
  assert.equal(value.asset_id, 'asset-1');
  assert.equal(value.transcript, '今天有点， 累了。');
  assert.deepEqual(value.segments.map((s) => [s.segment_id, s.text]), [['seg-0', '今天有点，'], ['seg-1', '累了。']]);
  assert.notEqual(value.transcript, value.segments.map((s) => s.text).join(''));
  assert.deepEqual(value.segments.map((s) => s.timing), [
    { status: 'available', start_ms: 0, end_ms: 1200, source: SOURCE },
    { status: 'available', start_ms: 1400, end_ms: 3900, source: SOURCE },
  ]);
  const [s0, s1] = value.segments;
  assert.deepEqual(s0.units.map((u) => [u.text, u.granularity, u.timing.start_ms, u.timing.end_ms, u.timing.source]), [
    ['今天', 'word', 0, 600, SOURCE], ['有', 'character', 600, 700, SOURCE], ['点', 'character', 650, 1200, SOURCE],
  ]);
  assert.deepEqual(s1.units.map((u) => [u.text, u.granularity, u.timing.source]), [['累', 'character', SOURCE], ['了', 'character', SOURCE]]);
  assert.ok(![s0, s1].some((s) => s.units.some((u) => u.text === '，' || u.text === '。')), 'punctuation must not become a timed unit');
  assert.deepEqual(value.observations.map((o) => [o.observation_id, o.label, o.segment_ids, o.timing, o.source_provider, o.source_model]), [
    ['emotion-0', 'tired', ['seg-0'], { status: 'available', start_ms: 0, end_ms: 1200, source: SOURCE }, 'aliyun', FILETRANS_MODEL],
    ['emotion-1', 'unknown-mood-x', ['seg-1'], { status: 'available', start_ms: 1400, end_ms: 3900, source: SOURCE }, 'aliyun', FILETRANS_MODEL],
  ]);
  assert.ok(!('score' in value.observations[0]), 'no invented emotion score');
  const c = value.capabilities;
  assert.deepEqual(c.word_timing, { status: 'ok', source_provider: 'aliyun', source_model: FILETRANS_MODEL });
  assert.deepEqual([c.emotion.status, c.prosody.status, c.sound_event.status], ['ok', 'unavailable', 'unavailable']);
  assert.ok(c.prosody.reason.length > 0 && c.sound_event.reason.length > 0);
  assert.deepEqual(value, success(FEATURE_RAW()));
  assert.equal(JSON.stringify(input), before, 'caller input must stay unchanged');
  const dumped = JSON.stringify(value);
  for (const leak of ['vendor_request_id', 'req-1', 'weight', '"id":7']) assert.ok(!dumped.includes(leak), `leaked ${leak}`);
});
test('emotion: exact labels, unknown labels, missing, partial and invalid types', () => {
  const second = S({ text: '再见。', begin_time: 1200, end_time: 2000, words: [W('再', 1200, 1600), W('见', 1600, 2000)] });
  const unlabeled = success(R({ sentences: [S(), second] }));
  assert.deepEqual(unlabeled.observations, []);
  assert.equal(unlabeled.capabilities.emotion.status, 'unavailable');
  assert.ok(unlabeled.capabilities.emotion.reason.length > 0);
  assert.equal(unlabeled.segments.length, 2);
  for (const [note, emotion] of [['empty string', ''], ['null', null]]) {
    const silent = success(R({ sentences: [S({ emotion })] }));
    assert.deepEqual(silent.observations, [], note);
    assert.equal(silent.capabilities.emotion.status, 'unavailable', note);
  }
  const partial = success(R({ sentences: [S({ emotion: 'joy' }), second] }));
  assert.deepEqual(partial.observations.map((o) => [o.observation_id, o.label, o.segment_ids]), [['emotion-0', 'joy', ['seg-0']]]);
  assert.equal(partial.capabilities.emotion.status, 'ok');
  failure(R({ sentences: [S({ emotion: 3 })] }), 'invalid_result', 'numeric emotion');
  failure(R({ sentences: [S({ emotion: { label: 'joy' } })] }), 'invalid_result', 'object emotion');
});
test('successful silence is valid and distinct from missing measured timing', () => {
  const silent = success(R({ text: '', sentences: [] }));
  assert.equal(silent.transcript, '');
  assert.deepEqual(silent.segments, []);
  assert.deepEqual(silent.observations, []);
  assert.equal(silent.capabilities.word_timing.status, 'ok');
  assert.equal(silent.capabilities.emotion.status, 'ok');
  failure(R({ sentences: [S({ words: [] })] }), 'timing_unavailable', 'silence is not missing timing');
});
test('frozen and null-prototype JSON records remain supported', () => {
  assert.equal(success(deepFreeze(R())).transcript, '你好。');
  const np = (o) => Object.assign(Object.create(null), o);
  const raw = np({ transcripts: [np({ channel_id: 0, text: '你好。', sentences: [np({
    begin_time: 0, end_time: 1000, text: '你好。', words: [np(W('你', 0, 400)), np(W('好', 400, 900))],
  })] })] });
  const value = success(raw);
  assert.equal(value.transcript, '你好。');
  assert.deepEqual(value.segments[0].units.map((u) => u.text), ['你', '好']);
});
test('nonempty speech without measured word timing is timing_unavailable', () => {
  const cases = {
    'words absent': R({ sentences: [drop(S(), 'words')] }),
    'words null': R({ sentences: [S({ words: null })] }),
    'words empty': R({ sentences: [S({ words: [] })] }),
    'word begin absent': R({ sentences: [S({ words: [drop(W('你', 0, 400), 'begin_time')] })] }),
    'word end null': R({ sentences: [S({ words: [W('你', 0, 400, { end_time: null })] })] }),
  };
  for (const [note, raw] of Object.entries(cases)) assert.ok(!('value' in failure(raw, 'timing_unavailable', note)));
  const zero = success(R({ sentences: [S({ begin_time: 0, end_time: 1000, words: [W('你', 0, 300)] })] }));
  assert.deepEqual(zero.segments[0].units[0].timing, { status: 'available', start_ms: 0, end_ms: 300, source: SOURCE });
});
test('invalid measured times are invalid_result without coercion', () => {
  const cases = {
    'sentence negative': R({ sentences: [S({ begin_time: -1 })] }),
    'sentence reversed': R({ sentences: [S({ begin_time: 900, end_time: 400 })] }),
    'sentence equal': R({ sentences: [S({ begin_time: 500, end_time: 500 })] }),
    'sentence fractional': R({ sentences: [S({ begin_time: 0.5 })] }),
    'sentence unsafe': R({ sentences: [S({ begin_time: 2 ** 53 })] }),
    'sentence NaN': R({ sentences: [S({ begin_time: Number.NaN })] }),
    'sentence Infinity': R({ sentences: [S({ end_time: Number.POSITIVE_INFINITY })] }),
    'sentence beyond duration': R({ sentences: [S({ end_time: 5000 })] }),
    'sentence numeric string': R({ sentences: [S({ begin_time: '0' })] }),
    'sentence date string': R({ sentences: [S({ begin_time: '2026-10-01' })] }),
    'sentence missing time': R({ sentences: [drop(S(), 'end_time')] }),
    'unit before parent': R({ sentences: [S({ begin_time: 100, end_time: 1000, words: [W('你', 0, 500)] })] }),
    'unit after parent': R({ sentences: [S({ words: [W('你', 0, 1200)] })] }),
    'unit negative': R({ sentences: [S({ words: [W('你', -5, 400)] })] }),
    'unit equal': R({ sentences: [S({ words: [W('你', 500, 500)] })] }),
    'unit fractional': R({ sentences: [S({ words: [W('你', 0.5, 400)] })] }),
    'unit unsafe': R({ sentences: [S({ words: [W('你', 0, 2 ** 53)] })] }),
    'unit numeric string': R({ sentences: [S({ words: [W('你', '0', 400)] })] }),
    'unit outside asset-valid parent': R({ sentences: [S({ begin_time: 2600, end_time: 3900, words: [W('你', 3000, 4000)] })] }),
  };
  for (const [note, raw] of Object.entries(cases)) failure(raw, 'invalid_result', note);
});
test('malformed structure is invalid_result', () => {
  const base = t0([S()]);
  const cases = {
    'null root': null,
    'primitive root': 42,
    'array root': [],
    'empty record root': {},
    'transcripts absent': { status: 'SUCCESS' },
    'transcripts empty': { transcripts: [] },
    'transcripts multiple': { transcripts: [base, base] },
    'transcripts not array': { transcripts: base },
    'transcript null': { transcripts: [null] },
    'channel wrong': { transcripts: [{ ...base, channel_id: 1 }] },
    'channel string': { transcripts: [{ ...base, channel_id: '0' }] },
    'channel absent': { transcripts: [drop(base, 'channel_id')] },
    'text absent': { transcripts: [drop(base, 'text')] },
    'text non-string': { transcripts: [{ ...base, text: 123 }] },
    'nonempty transcript no sentences': t0([]),
    'empty transcript with speech': { transcripts: [{ channel_id: 0, text: '', sentences: [S()] }] },
    'whitespace transcript': { transcripts: [{ channel_id: 0, text: '   ', sentences: [S()] }] },
    'sentences not array': { transcripts: [{ channel_id: 0, text: '你好。', sentences: {} }] },
    'sentence null': R({ sentences: [null] }),
    'sentence primitive': R({ sentences: [5] }),
    'sentence text blank': R({ sentences: [S({ text: '  ' })] }),
    'sentence text absent': R({ sentences: [drop(S(), 'text')] }),
    'words not array': R({ sentences: [S({ words: {} })] }),
    'word null': R({ sentences: [S({ words: [null] })] }),
    'word text absent': R({ sentences: [S({ words: [drop(W('你', 0, 400), 'text')] })] }),
    'word text non-string': R({ sentences: [S({ words: [W(7, 0, 400)] })] }),
    'word text blank': R({ sentences: [S({ words: [W('   ', 0, 400)] })] }),
    'punctuation wrong type': R({ sentences: [S({ words: [W('你', 0, 400, { punctuation: 5 })] })] }),
  };
  for (const [note, raw] of Object.entries(cases)) failure(raw, 'invalid_result', note);
  assert.equal(success(R()).transcript, '你好。');
});
test('exotic containers and accessors are rejected without invoking getters', () => {
  const counter = { n: 0 };
  const bump = (production) => ({ get() { counter.n += 1; return production(); }, enumerable: true, configurable: true });
  const sentence = S();
  const sparse = [sentence]; sparse.length = 2;
  const extraKey = [sentence]; extraKey.vendor = 1;
  const swapped = [sentence]; Object.setPrototypeOf(swapped, {});
  const customProto = Object.assign(Object.create({ inherited: 1 }), t0([sentence]));
  const hidden = S(); Object.defineProperty(hidden, 'text', { value: '你好。', enumerable: false, configurable: true });
  const symboled = t0([sentence]); symboled[Symbol('s')] = 1;
  const sentenceGetter = S(); Object.defineProperty(sentenceGetter, 'text', bump(() => '你好。'));
  const wordGetter = W('你', 0, 400); Object.defineProperty(wordGetter, 'begin_time', bump(() => 0));
  const unknownGetter = S(); Object.defineProperty(unknownGetter, 'vendor_note', bump(() => 'x'));
  const rootGetter = {}; Object.defineProperty(rootGetter, 'transcripts', bump(() => [t0([sentence])]));
  const indexGetter = []; Object.defineProperty(indexGetter, 0, bump(() => t0([sentence])));
  const cases = {
    'sparse sentences': R({ sentences: sparse }),
    'extra array key': R({ sentences: extraKey }),
    'swapped array prototype': R({ sentences: swapped }),
    'custom record prototype': { transcripts: [customProto] },
    'non-enumerable field': R({ sentences: [hidden] }),
    'symbol field': { transcripts: [symboled] },
    'root getter': rootGetter,
    'array index getter': { transcripts: indexGetter },
    'sentence getter': R({ sentences: [sentenceGetter] }),
    'word getter': R({ sentences: [S({ words: [wordGetter] })] }),
    'unknown field getter': R({ sentences: [unknownGetter] }),
  };
  for (const [note, raw] of Object.entries(cases)) failure(raw, 'invalid_result', note);
  assert.equal(counter.n, 0, 'accessors must never be invoked');
});
test('processing bounds reject oversized input without truncation', () => {
  const word = W('你', 0, 500);
  const sentence = { begin_time: 0, end_time: 1000, text: '你', words: [word] };
  const many = (sentences) => ({ transcripts: [{ channel_id: 0, text: '你', sentences }] });
  failure(many(fill(10001, sentence)), 'invalid_result', '10001 sentences');
  failure(many([{ begin_time: 0, end_time: 1000, text: '你', words: fill(100001, word) }]), 'invalid_result', '100001 words in one sentence');
  failure(many([
    { begin_time: 0, end_time: 1000, text: '你', words: fill(60001, W('你', 0, 500)) },
    { begin_time: 1000, end_time: 2000, text: '你', words: fill(60001, W('你', 1000, 1500)) },
  ]), 'invalid_result', '120002 words across sentences');
  assert.equal(success(many(fill(10000, sentence))).segments.length, 10000);
});
test('failures use safe static messages with no raw payload or identifiers', () => {
  const secret = 'https://oss.example.com/audio?Signature=SECRETKEY&requestId=req-42';
  const raw = { transcripts: [{ channel_id: 1, text: secret, sentences: [], task_id: 'task-9', access_key: 'AKIAEXAMPLE' }] };
  const e = failure(raw, 'invalid_result', 'channel mismatch with sensitive payload');
  for (const leak of ['http', 'SECRETKEY', 'req-42', 'task-9', 'AKIAEXAMPLE', 'oss.example']) {
    assert.ok(!e.message.includes(leak), `message leaked ${leak}`);
  }
  const invalidAsset = failure(R(), 'invalid_audio', 'invalid asset wins over valid raw', BAD_ASSET);
  failure(null, 'invalid_audio', 'invalid asset wins over invalid raw', BAD_ASSET);
  assert.ok(!invalidAsset.message.includes('asset-1'));
});
