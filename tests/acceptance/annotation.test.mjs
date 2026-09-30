// M01 acceptance tests for the provider-independent annotation contracts.
// Synthetic fixtures only: no real audio, no credentials, no provider calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAudioAsset, validateAnnotatedAudio, parseAnnotatedAudio, serializeAnnotatedAudio,
} from '../../apps/server/src/domain/annotation.ts';

const at = (a, b) => ({ status: 'available', start_ms: a, end_ms: b, source: 'forced-aligner' });
const no = (reason = 'asr does not report word timing') => ({ status: 'unavailable', reason });
const cap = (p, m) => ({ status: 'ok', source_provider: p, source_model: m });
const gap = (s, reason) => ({ status: s, reason });
const ASSET = { asset_id: 'asset-1', media_type: 'audio/wav', duration_ms: 4000, sample_rate_hz: 16000, channels: 1 };
const drop = (o, k) => (({ [k]: _omit, ...rest }) => rest)(o);

const doc = () => ({
  schema_version: '0.1',
  asset_id: 'asset-1',
  transcript: '今日は少し疲れているみたいですね。',
  segments: [
    { segment_id: 'seg-0', text: '今日は少し', timing: at(0, 1200), units: [
      { text: '今日', granularity: 'word', timing: at(0, 600) },
      { text: 'は', granularity: 'word', timing: at(700, 780) },
      { text: '少し', granularity: 'word', timing: at(900, 1200) },
    ] },
    { segment_id: 'seg-1', text: '疲れているみたいですね。', speaker_id: 'speaker-a', timing: at(1400, 3900) },
  ],
  observations: [
    { observation_id: 'obs-0', kind: 'emotion', label: 'sad', timing: at(0, 3900), source_provider: 'emo-lab',
      source_model: 'emo-v2', score: { value: 0.62, semantics: 'probability' }, segment_ids: ['seg-0', 'seg-1'] },
    { observation_id: 'obs-1', kind: 'sound_event', label: 'laughter', timing: at(2200, 3100),
      source_provider: 'sv-det', source_model: 'sv-1', segment_ids: ['seg-1'] },
    { observation_id: 'obs-2', kind: 'sound_event', label: 'laughter', timing: at(2600, 3400),
      source_provider: 'sv-det', source_model: 'sv-1' },
  ],
  capabilities: {
    word_timing: cap('align', 'fa-1'), emotion: cap('emo-lab', 'emo-v2'),
    prosody: gap('failed', 'prosody detector not configured'), sound_event: cap('sv-det', 'sv-1'),
  },
});

const edit = (fn) => { const d = doc(); fn(d); return d; };
const va = (d, a = ASSET) => validateAnnotatedAudio(d, a);
const pathsOf = (r) => (r.issues || []).map((i) => i.path).join('\n');
const textOf = (r) => (r.issues || []).map((i) => `${i.path} ${i.message}`).join('\n');
const checkIssues = (r, note) => {
  assert.equal(r.ok, false, `${note}: unexpectedly passed ${JSON.stringify(r)}`);
  assert.ok(Array.isArray(r.issues) && r.issues.length > 0, `${note}: no issues`);
  for (const i of r.issues) {
    assert.ok(typeof i.path === 'string' && i.path.length > 0, `${note}: bad issue path ${JSON.stringify(i)}`);
    assert.ok(typeof i.message === 'string' && i.message.length > 0, `${note}: bad issue message ${JSON.stringify(i)}`);
  }
};

test('valid Chinese annotation round-trips with no mutation, no coercion', () => {
  const input = doc();
  const before = structuredClone(input);
  const r = va(input);
  assert.equal(r.ok, true, textOf(r));
  assert.deepEqual(r.value, input);
  assert.deepEqual(input, before, 'validator mutated its input');
  const json = serializeAnnotatedAudio(input, ASSET);
  const again = parseAnnotatedAudio(json, ASSET);
  assert.equal(again.ok, true, textOf(again));
  assert.deepEqual(again.value, before);
  const broken = edit((x) => { delete x.transcript; });
  const brokenBefore = structuredClone(broken);
  checkIssues(va(broken), 'missing transcript');
  assert.deepEqual(broken, brokenBefore, 'failed validation mutated its input');
});

test('frozen data and null-prototype own-property records are accepted', () => {
  const freeze = (x) => {
    for (const k of Object.getOwnPropertyNames(x)) if (x[k] && typeof x[k] === 'object') freeze(x[k]);
    return Object.freeze(x);
  };
  const r = va(freeze(doc()), freeze(structuredClone(ASSET)));
  assert.equal(r.ok, true, textOf(r));
  const np = Object.assign(Object.create(null), structuredClone(doc()));
  const r2 = va(np, ASSET);
  assert.equal(r2.ok, true, textOf(r2));
  assert.deepEqual(JSON.parse(serializeAnnotatedAudio(np, ASSET)), doc());
});

test('missing word timing and unknown emotion stay explicit, never fabricated', () => {
  const d = edit((x) => {
    x.capabilities.word_timing = gap('unavailable', 'asr has no alignment support');
    for (const s of x.segments) for (const u of s.units || []) u.timing = no();
    x.observations = [{ observation_id: 'obs-0', kind: 'emotion', label: 'unknown', timing: at(0, 3900),
      source_provider: 'emo-lab', source_model: 'emotion-less' }];
  });
  const r = va(d);
  assert.equal(r.ok, true, textOf(r));
  const unit = r.value.segments[0].units[0];
  assert.deepEqual(unit.timing, { status: 'unavailable', reason: 'asr has no alignment support' });
  assert.ok(!('start_ms' in unit.timing) && !('end_ms' in unit.timing), 'fabricated zero timestamps');
  assert.ok(!JSON.stringify(r.value.segments[0].units).includes('start_ms'));
  assert.equal(r.value.observations[0].label, 'unknown');
  assert.equal(r.value.observations[0].score, undefined, 'fabricated score');
});

test('empty results with ok differ from unavailable and failed detectors', () => {
  const variants = [
    [cap('sv-det', 'sv-1'), 'ok'],
    [gap('unavailable', 'no sound event detector installed'), 'unavailable'],
    [gap('failed', 'sound event detector returned an error'), 'failed'],
  ];
  const values = variants.map(([capability, status]) => {
    const r = va(edit((x) => { x.observations = []; x.capabilities.sound_event = capability; }));
    assert.equal(r.ok, true, `${status}: ${textOf(r)}`);
    return r.value.capabilities.sound_event;
  });
  assert.equal(values[0].status, 'ok');
  assert.notDeepEqual(values[0], values[1]);
  assert.notDeepEqual(values[1], values[2]);
  assert.equal(values[1].reason, 'no sound event detector installed');
});

test('silent transcript with empty arrays is valid', () => {
  const d = edit((x) => {
    x.transcript = ''; x.segments = []; x.observations = [];
    for (const k of Object.keys(x.capabilities)) x.capabilities[k] = gap('unavailable', 'no speech detected');
  });
  const r = va(d);
  assert.equal(r.ok, true, textOf(r));
  assert.deepEqual(r.value.segments, []);
  assert.deepEqual(r.value.observations, []);
});

test('scores keep semantics and are not normalized or forced into one distribution', () => {
  const mk = (id, provider, value, semantics) => ({ observation_id: id, kind: 'emotion', label: id === 'o1' ? 'joy' : 'sad',
    timing: at(0, 3900), source_provider: provider, source_model: 'm', score: { value, semantics }, segment_ids: ['seg-0'] });
  const d = edit((x) => { x.observations = [mk('o1', 'a', 7.4, 'ordinal'), mk('o2', 'b', 120, 'uncalibrated_score')]; });
  const r = va(d);
  assert.equal(r.ok, true, textOf(r));
  assert.deepEqual(r.value.observations.map((o) => o.score),
    [{ value: 7.4, semantics: 'ordinal' }, { value: 120, semantics: 'uncalibrated_score' }]);
});

test('non-contiguous units and overlapping sound events are allowed', () => {
  const r = va(doc());
  assert.equal(r.ok, true, textOf(r));
  const u = r.value.segments[0].units;
  assert.ok(u[1].timing.start_ms > u[0].timing.end_ms, 'fixture should show a gap');
  const e = r.value.observations.filter((o) => o.kind === 'sound_event');
  assert.equal(e.length, 2);
  assert.ok(e[1].timing.start_ms < e[0].timing.end_ms, 'fixture should show an overlap');
});

const TIMES = [
  ['negative start', at(-1, 1200)],
  ['start after end', at(2000, 1000)],
  ['equal start and end', at(1000, 1000)],
  ['fractional start', at(0.5, 1200)],
  ['end beyond asset duration', at(0, 4500)],
  ['unsafe integer end', at(0, 2 ** 53)],
  ['null boundaries', { status: 'available', start_ms: null, end_ms: null, source: 'clock' }],
  ['missing source', { status: 'available', start_ms: 0, end_ms: 1200 }],
];
for (const [label, t] of TIMES) {
  test(`measured segment timing rejected: ${label}`, () => {
    const r = va(edit((x) => { x.segments[0].timing = t; }));
    checkIssues(r, label);
    assert.match(pathsOf(r), /segments\[0\]\.timing/);
  });
  test(`measured unit timing rejected: ${label}`, () => {
    const r = va(edit((x) => { x.segments[0].units[0].timing = t; }));
    checkIssues(r, label);
    assert.match(textOf(r), /units/);
  });
}
for (const [label, t] of [['unit starts before parent', at(-5, 900)], ['unit ends after parent', at(900, 3800)]]) {
  test(`unit interval outside measured parent segment: ${label}`, () => {
    const r = va(edit((x) => { x.segments[0].units = [{ text: '今日', granularity: 'word', timing: t }]; }));
    checkIssues(r, label);
    assert.match(textOf(r), /units|segments\[0\]/);
  });
}

const BAD = [
  ['unknown root key', (x) => { x.mode = 'auto'; }, /mode/],
  ['unknown segment key', (x) => { x.segments[0].lang = 'ja'; }, /lang|segments\[0\]/],
  ['unknown timing key', (x) => { x.segments[1].timing.unit = 'ms'; }, /unit|timing/],
  ['unknown unit key', (x) => { x.segments[0].units[0].confidence = 1; }, /units|confidence/],
  ['unknown observation key', (x) => { x.observations[1].channel = 2; }, /channel|observations/],
  ['unknown score key', (x) => { x.observations[0].score.calibrated = true; }, /calibrated|score/],
  ['unknown capability key', (x) => { x.capabilities.emotion.note = 'x'; }, /note|emotion|capabilit/],
  ['schema_version 0.2', (x) => { x.schema_version = '0.2'; }, /schema_version/],
  ['missing required fields', (x) => { delete x.transcript; delete x.segments[1].timing;
    delete x.observations[1].source_model; delete x.capabilities.prosody; },
    /(transcript|timing|source_model|prosody|capabilities)/],
  ['mismatched asset_id', (x) => { x.asset_id = 'asset-2'; }, /asset_id|asset/],
  ['empty identifier', (x) => { x.segments[0].segment_id = ''; }, /segment_id|segments\[0\]/],
  ['empty timing reason', (x) => { x.capabilities.prosody = gap('failed', ''); }, /reason|prosody/],
  ['malformed containers', (x) => { x.segments = null; x.observations = 'none'; }, /(segments|observations)/],
  ['capabilities as array', (x) => { x.capabilities = []; }, /capabilit/],
  ['non-string text', (x) => { x.segments[0].text = 42; }, /text|segments\[0\]/],
  ['null timing status', (x) => { x.segments[0].timing = { status: null }; }, /status|timing/],
  ['bad timing enum', (x) => { x.segments[0].timing = { status: 'maybe', start_ms: 0, end_ms: 1, source: 's' }; }, /status|maybe/],
  ['unavailable timing carrying times', (x) => { x.segments[0].timing = { status: 'unavailable', reason: 'x', start_ms: 0, end_ms: 1 }; }, /timing|unavailable|start_ms/],
  ['unavailable timing without reason', (x) => { x.segments[0].timing = { status: 'unavailable' }; }, /reason|timing/],
  ['bad observation kind', (x) => { x.observations[1].kind = 'music'; }, /kind|music/],
  ['bad unit granularity', (x) => { x.segments[0].units[0].granularity = 'syllable'; }, /granularity|syllable/],
  ['bad capability status', (x) => { x.capabilities.emotion = { status: 'unknown', reason: 'x' }; }, /status|emotion/],
  ['ok capability without provenance', (x) => { x.capabilities.sound_event = { status: 'ok', source_provider: 'sv' }; }, /source_model|capabilit/],
  ['duplicate segment id', (x) => { x.segments[1].segment_id = 'seg-0'; }, /segment_id|segments\[1\]/],
  ['duplicate observation id', (x) => { x.observations[2].observation_id = 'obs-1'; }, /observation_id|observations\[2\]/],
  ['reference to absent segment', (x) => { x.observations[1].segment_ids = ['seg-9']; }, /seg-9|segment_ids/],
  ['segment_ids not strings', (x) => { x.observations[0].segment_ids = ['seg-0', 7]; }, /segment_ids|observations/],
  ['emotion observation without ok capability', (x) => { x.capabilities.emotion = gap('unavailable', 'not supported'); }, /emotion|capabilit/],
  ['sound event observation on failed detector', (x) => { x.capabilities.sound_event = gap('failed', 'crashed'); }, /sound_event|capabilit/],
  ['measured units without word timing ok', (x) => { x.capabilities.word_timing = gap('unavailable', 'no alignment'); }, /word_timing|units|capabilit/],
  ['probability above one', (x) => { x.observations[0].score.value = 1.01; }, /score|value/],
  ['confidence below zero', (x) => { x.observations[0].score = { value: -0.2, semantics: 'confidence' }; }, /score|value/],
  ['NaN score', (x) => { x.observations[0].score = { value: Number.NaN, semantics: 'probability' }; }, /score|NaN|finite/],
  ['infinite ordinal score', (x) => { x.observations[1].score = { value: Number.POSITIVE_INFINITY, semantics: 'ordinal' }; }, /score|finite/],
  ['bad score semantics', (x) => { x.observations[0].score.semantics = 'percent'; }, /semantics/],
  ['sparse segments', (x) => { x.segments = new Array(1); }, /segments\[0\]/],
  ['sparse observations', (x) => { x.observations = new Array(2); }, /observations/],
  ['sparse units', (x) => { x.segments[0].units = new Array(1); }, /units/],
  ['sparse segment_ids', (x) => { x.observations[0].segment_ids = new Array(2); }, /segment_ids|observations/],
  ['extra own array key', (x) => { x.segments.extra = 'x'; }, /segments|extra/],
  ['non-enumerable array key', (x) => { Object.defineProperty(x.observations, 'x', { value: 1 }); }, /observations/],
  ['non-enumerable record field', (x) => { Object.defineProperty(x.segments[1], 'speaker_id', { value: 's' }); }, /speaker_id|segments\[1\]/],
  ['symbol record key', (x) => { Object.defineProperty(x, Symbol('s'), { value: 1 }); }, null],
  ['array subclass instance', (x) => { x.segments = Object.assign([structuredClone(x.segments[0])], {});
    Object.setPrototypeOf(x.segments, Object.create(Array.prototype)); }, /segments/],
];
for (const [label, apply, re] of BAD) test(`rejected: ${label}`, () => {
  const r = va(edit(apply));
  checkIssues(r, label);
  if (re) assert.match(textOf(r), re);
});

let hits = 0;
const spy = (o, k) => { const v0 = o[k]; Object.defineProperty(o, k, { get() { hits += 1; return v0; }, enumerable: true, configurable: true }); };
const ACCESSORS = [
  ['root segments field', (d) => spy(d, 'segments')],
  ['segment text field', (d) => spy(d.segments[0], 'text')],
  ['unit timing field', (d) => spy(d.segments[0].units[1], 'timing')],
  ['observation label field', (d) => spy(d.observations[1], 'label')],
  ['score value field', (d) => spy(d.observations[0].score, 'value')],
  ['capability status field', (d) => spy(d.capabilities.emotion, 'status')],
  ['indexed segment element', (d) => spy(d.segments, '0')],
  ['indexed observation element', (d) => spy(d.observations, '2')],
  ['indexed unit element', (d) => spy(d.segments[0].units, '0')],
];
for (const [label, apply] of ACCESSORS) test(`user getters never invoked: ${label}`, () => {
  hits = 0;
  const d = doc();
  apply(d);
  checkIssues(va(d), label);
  assert.equal(hits, 0, 'validator read an accessor property');
  assert.throws(() => serializeAnnotatedAudio(d, ASSET), (e) => e instanceof Error && e.message.length > 0);
});

test('inherited fields and custom prototypes are rejected, plain JSON supported', () => {
  checkIssues(va(Object.create(doc())), 'prototype-only document');
  const withInherited = Object.create({ extra: 1 });
  Object.assign(withInherited, doc());
  checkIssues(va(withInherited), 'inherited extra field');
  checkIssues(va(edit((x) => { x.segments[0] = Object.create(doc().segments[0]); })), 'inherited segment field');
  const parsed = parseAnnotatedAudio(JSON.stringify(doc()), ASSET);
  assert.equal(parsed.ok, true, textOf(parsed));
  assert.deepEqual(parsed.value, doc());
});

const ASSET_BAD = [
  ['null', null], ['undefined', undefined], ['array', []], ['string', 'audio/wav'], ['number', 7],
  ['empty asset_id', { ...ASSET, asset_id: '' }], ['missing asset_id', drop(ASSET, 'asset_id')],
  ['missing duration_ms', drop(ASSET, 'duration_ms')], ['null media_type', { ...ASSET, media_type: null }],
  ['non-audio media_type', { ...ASSET, media_type: 'video/mp4' }], ['zero duration', { ...ASSET, duration_ms: 0 }],
  ['negative duration', { ...ASSET, duration_ms: -40 }], ['fractional duration', { ...ASSET, duration_ms: 1.5 }],
  ['NaN duration', { ...ASSET, duration_ms: Number.NaN }], ['unsafe duration', { ...ASSET, duration_ms: 2 ** 53 }],
  ['zero sample_rate_hz', { ...ASSET, sample_rate_hz: 0 }], ['string channels', { ...ASSET, channels: 'mono' }],
  ['unknown storage path key', { ...ASSET, file_path: 'C:/tmp/a.wav' }],
  ['non-enumerable field', Object.defineProperty({ ...ASSET }, 'asset_id', { value: 'x' })],
  ['symbol key', Object.defineProperty({ ...ASSET }, Symbol('s'), { value: 1 })],
];
for (const [label, a] of ASSET_BAD) test(`validateAudioAsset rejects ${label}`, () => checkIssues(validateAudioAsset(a), label));

test('validateAudioAsset accepts real metadata and explicit nulls', () => {
  const r = validateAudioAsset(ASSET);
  assert.equal(r.ok, true, textOf(r));
  assert.deepEqual(r.value, ASSET);
  assert.equal(validateAudioAsset({ ...ASSET, sample_rate_hz: null, channels: null }).ok, true);
  assert.equal(validateAudioAsset({ ...ASSET, media_type: 'audio/flac' }).ok, true);
});

test('asset argument is validated with the document', () => {
  for (const a of [null, undefined, 'asset-1', [], { ...ASSET, media_type: 'video/mp4' },
    { ...ASSET, duration_ms: 10 }, drop(ASSET, 'channels')]) checkIssues(va(doc(), a), 'bad asset argument');
  assert.equal(va(doc(), { ...ASSET, sample_rate_hz: null }).ok, true);
});

test('parseAnnotatedAudio never throws on malformed input', () => {
  for (const s of ['', 'not json', '{', '[1,', 'null', '42', '"text', 'undefined']) {
    checkIssues(parseAnnotatedAudio(s, ASSET), `json ${JSON.stringify(s)}`);
  }
  for (const x of [null, undefined, 42, true, {}, [], doc()]) {
    checkIssues(parseAnnotatedAudio(x, ASSET), `non-string ${typeof x}`);
  }
});

test('serializeAnnotatedAudio throws field-path errors and preserves the schema', () => {
  assert.throws(() => serializeAnnotatedAudio(edit((x) => { x.segments[0].timing = at(3000, 100); }), ASSET), /timing/);
  assert.throws(() => serializeAnnotatedAudio(edit((x) => { x.observations[1].segment_ids = ['seg-9']; }), ASSET), /seg-9|segment_ids/);
  assert.throws(() => serializeAnnotatedAudio(doc(), { ...ASSET, duration_ms: 10 }), /asset|duration|timing|segments/);
  assert.throws(() => serializeAnnotatedAudio(null, ASSET), (e) => e instanceof Error);
  const out = JSON.parse(serializeAnnotatedAudio(doc(), ASSET));
  assert.deepEqual(out, doc());
  assert.deepEqual(Object.keys(out).sort(), ['asset_id', 'capabilities', 'observations', 'schema_version', 'segments', 'transcript']);
  assert.deepEqual(Object.keys(out.segments[0]).sort(), ['segment_id', 'text', 'timing', 'units']);
  assert.deepEqual(Object.keys(out.segments[1]).sort(), ['segment_id', 'speaker_id', 'text', 'timing']);
  assert.deepEqual(Object.keys(out.observations[0]).sort(), ['kind', 'label', 'observation_id', 'score', 'segment_ids', 'source_model', 'source_provider', 'timing']);
  assert.deepEqual(Object.keys(out.observations[2]).sort(), ['kind', 'label', 'observation_id', 'source_model', 'source_provider', 'timing']);
  assert.deepEqual(Object.keys(out.observations[0].score).sort(), ['semantics', 'value']);
  assert.deepEqual(Object.keys(out.capabilities).sort(), ['emotion', 'prosody', 'sound_event', 'word_timing']);
});
