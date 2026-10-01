// M02c independent acceptance tests for the Alibaba model-bound temporary audio
// publication adapter (AudioPublicationPort implementation).
//
// Synthetic only: no real audio, credentials, outbound calls, filesystem reads
// or ASR work. Every request goes through an injected mock fetch, and every
// failure is checked against the public AnalysisFailure shape
// (stage "publication", retryable false, no leaked key/body/URL/cause).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlibabaTemporaryPublication } from '../../apps/server/src/providers/aliyun/temporary-publication.ts';
import { FILETRANS_MODEL } from '../../apps/server/src/providers/aliyun/filetrans-result.ts';

const KEY = 'test-api-key';
const STORAGE_KEY = 'clip-01';
const T0 = 1_700_000_000_000;
const MEDIA_LIFETIME_MS = 48 * 60 * 60 * 1000;
const GET_URL = `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(FILETRANS_MODEL)}`;
const OSS_ORIGIN = 'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com';
const UPLOAD_DIR = 'dashscope/uploads';
const CONFIG_MESSAGE = 'invalid temporary publication configuration';
const FAILURE_KEYS = ['code', 'message', 'retryable', 'stage'];
const LEAK_MARKERS = [
  KEY, 'policy-token', 'signature-token', 'sts-key-id',
  'dashscope.aliyuncs.com', 'oss-cn-beijing', 'provider-body-secret',
  '/home/user/private/clip.wav', 'internal.example', 'objectId source failed',
  'internal socket timed out',
];

const WAV_BYTES = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
const wavBlob = (bytes = WAV_BYTES, type = 'audio/wav') => new Blob([bytes], { type });
const asset = (over = {}) => ({
  asset_id: 'asset-1', media_type: 'audio/wav', duration_ms: 4000,
  sample_rate_hz: 16000, channels: 1, ...over,
});
const storedAudio = (over = {}) => ({ asset: asset(), storage_key: STORAGE_KEY, ...over });
const without = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };

const policyData = (over = {}) => ({
  policy: 'policy-token',
  signature: 'signature-token',
  upload_dir: UPLOAD_DIR,
  upload_host: OSS_ORIGIN,
  oss_access_key_id: 'sts-key-id',
  x_oss_object_acl: 'private',
  x_oss_forbid_overwrite: 'true',
  expire_in_seconds: 300,
  max_file_size_mb: 10,
  ...over,
});
const policyPayload = (over = {}) => ({ data: policyData(over) });
const jsonResponse = (payload, status = 200, headers = {}) =>
  new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const policyResponse = (over = {}) => jsonResponse(policyPayload(over));
const okUpload = () => new Response(null, { status: 200 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function makeHarness(config = {}) {
  const reads = [];
  const defaultRead = (key, signal) => {
    reads.push({ key, signal });
    return Promise.resolve(config.blob ?? wavBlob());
  };
  const plan = config.plan ?? [() => policyResponse(), () => okUpload()];
  const fetchImpl = (url, init) => {
    const index = fetchImpl.calls.length;
    fetchImpl.calls.push({ url: typeof url === 'string' ? url : String(url), init });
    const step = plan[Math.min(index, plan.length - 1)];
    return Promise.resolve(typeof step === 'function' ? step(index) : step);
  };
  fetchImpl.calls = [];
  const adapter = new AlibabaTemporaryPublication({
    apiKey: config.apiKey ?? KEY,
    readAudio: config.readAudio ?? defaultRead,
    maxBytes: config.maxBytes ?? 1_000_000,
    timeoutMs: config.timeoutMs ?? 1000,
    fetch: fetchImpl,
    now: config.now ?? (() => T0),
    objectId: config.objectId ?? (() => 'obj-xyz'),
  });
  return { adapter, fetchImpl, reads };
}

async function invoke(instance, { audio = storedAudio(), model = FILETRANS_MODEL, signal } = {}) {
  const controller = signal === undefined ? new AbortController() : null;
  try {
    const value = await instance.publish(audio, { model, signal: signal ?? controller.signal });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function expectFailure(result, code, note = 'case') {
  assert.equal(result.ok, false, `${note}: expected ${code}, received success ${JSON.stringify(result.value)}`);
  const error = result.error;
  assert.ok(typeof error === 'object' && error !== null && !Array.isArray(error), `${note}: failure must be an object`);
  assert.equal(error instanceof Error, false, `${note}: failure must be a plain object, not an Error`);
  assert.equal(Object.getPrototypeOf(error), Object.prototype, `${note}: failure must be a plain record`);
  assert.deepEqual(Object.keys(error).sort(), FAILURE_KEYS, `${note}: failure keys`);
  assert.equal(error.code, code, `${note}: code`);
  assert.equal(error.stage, 'publication', `${note}: stage`);
  assert.equal(error.retryable, false, `${note}: retryable`);
  assert.ok(typeof error.message === 'string' && error.message.length > 0, `${note}: message`);
  return error;
}

function assertSafe(error) {
  const text = JSON.stringify(error);
  for (const marker of LEAK_MARKERS) {
    assert.ok(!text.includes(marker), `failure leaked "${marker}": ${text}`);
  }
}

// --- Happy path -----------------------------------------------------------

test('happy path: one read, policy GET, one OSS POST, exact reference and no mutation', async () => {
  const harness = makeHarness();
  const input = storedAudio();
  const before = JSON.stringify(input);

  const result = await invoke(harness.adapter, { audio: input });
  assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
  const reference = result.value;
  assert.deepEqual(Object.keys(reference).sort(), ['expires_at_ms', 'model', 'transport', 'uri']);
  assert.equal(reference.uri, `oss://${UPLOAD_DIR}/obj-xyz.wav`);
  assert.equal(reference.model, FILETRANS_MODEL);
  assert.equal(reference.transport, 'oss-resource');
  assert.equal(reference.expires_at_ms, T0 + MEDIA_LIFETIME_MS, 'media lifetime is arrival + 48h');
  assert.notEqual(reference.expires_at_ms, T0 + 300_000, 'expiry must not be the credential TTL');

  assert.equal(harness.reads.length, 1, 'exactly one local read');
  assert.equal(harness.reads[0].key, STORAGE_KEY);

  assert.equal(harness.fetchImpl.calls.length, 2, 'no ASR job calls and no retries');
  const [get, post] = harness.fetchImpl.calls;
  assert.equal(get.url, GET_URL, 'policy GET uses the exact model query');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.redirect, 'error');
  assert.equal(get.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(get.init.headers['Content-Type'], 'application/json');
  assert.ok(get.init.signal instanceof AbortSignal);

  assert.equal(post.url, `${OSS_ORIGIN}/`, 'POST targets the OSS host root');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.redirect, 'error');
  assert.equal(post.init.headers, undefined, 'no API Authorization or manual Content-Type on POST');

  assert.equal(harness.reads[0].signal, get.init.signal, 'reader and policy GET share the signal');
  assert.equal(get.init.signal, post.init.signal, 'policy GET and upload POST share the signal');

  const form = post.init.body;
  assert.ok(form instanceof FormData);
  const entries = [...form.entries()];
  assert.deepEqual(
    entries.map(([name]) => name),
    ['OSSAccessKeyId', 'Signature', 'policy', 'x-oss-object-acl', 'x-oss-forbid-overwrite', 'key', 'success_action_status', 'file'],
  );
  assert.equal(entries[entries.length - 1][0], 'file', 'file field must stay last');
  assert.deepEqual(Object.fromEntries(entries.filter(([, value]) => typeof value === 'string')), {
    OSSAccessKeyId: 'sts-key-id',
    Signature: 'signature-token',
    policy: 'policy-token',
    'x-oss-object-acl': 'private',
    'x-oss-forbid-overwrite': 'true',
    key: `${UPLOAD_DIR}/obj-xyz.wav`,
    success_action_status: '200',
  });
  const file = form.get('file');
  assert.ok(file instanceof Blob);
  assert.equal(file.name, 'obj-xyz.wav', 'generated key stem plus extension');
  assert.equal(file.type, 'audio/wav');
  assert.equal(file.size, WAV_BYTES.length);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...WAV_BYTES]);
  assert.ok(!form.get('key').includes(STORAGE_KEY), 'key must not reuse the caller storage key');

  assert.equal(JSON.stringify(input), before, 'caller input unchanged');
});

test('numeric policy fields accept documented number and decimal-string forms', async () => {
  const variants = [
    { expire_in_seconds: 300, max_file_size_mb: 10 },
    { expire_in_seconds: '300', max_file_size_mb: '10' },
    { expire_in_seconds: '600.0', max_file_size_mb: '1.5' },
  ];
  for (const over of variants) {
    const harness = makeHarness({ plan: [() => policyResponse(over), () => okUpload()] });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `${JSON.stringify(over)}: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.expires_at_ms, T0 + MEDIA_LIFETIME_MS);
    assert.equal(harness.fetchImpl.calls.length, 2);
  }
});

// --- Numeric policy validation -------------------------------------------

test('invalid numeric policy fields fail safely without a POST', async () => {
  const rawPolicy = (field, literal) => {
    const json = JSON.stringify(policyPayload());
    const needle = `"${field}":${JSON.stringify(policyData()[field])}`;
    assert.ok(json.includes(needle), `fixture token for ${field} missing`);
    return json.replace(needle, `"${field}":${literal}`);
  };
  const cases = [
    ['expire_in_seconds', 'true'], ['expire_in_seconds', 'false'],
    ['expire_in_seconds', '"1e3"'], ['expire_in_seconds', '"300.5"'],
    ['expire_in_seconds', '300.5'], ['expire_in_seconds', '-300'],
    ['expire_in_seconds', '0'], ['expire_in_seconds', '1e999'],
    ['expire_in_seconds', '-1e999'], ['expire_in_seconds', '"abc"'],
    ['expire_in_seconds', '"300x"'], ['expire_in_seconds', 'null'],
    ['max_file_size_mb', 'true'], ['max_file_size_mb', '"1e3"'],
    ['max_file_size_mb', '0'], ['max_file_size_mb', '-2'],
    ['max_file_size_mb', '"0.0"'], ['max_file_size_mb', '1e999'],
    ['max_file_size_mb', '1e18'],
  ];
  for (const [field, literal] of cases) {
    const harness = makeHarness({ plan: [() => new Response(rawPolicy(field, literal), { status: 200 })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `${field}=${literal}`);
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 1, `${field}=${literal}: no POST`);
  }
});

test('an unsafe expiry epoch fails safely', async () => {
  const harness = makeHarness({ now: () => Number.MAX_SAFE_INTEGER });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'unsafe epoch');
  assertSafe(result.error);
  assert.equal(harness.fetchImpl.calls.length, 1, 'no POST after an unsafe expiry');
});

// --- Size limits ----------------------------------------------------------

test('a policy size limit smaller than the configured limit rejects the blob before the POST', async () => {
  const harness = makeHarness({ maxBytes: 1_000_000, plan: [() => policyResponse({ max_file_size_mb: 0.000001 })] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'invalid_audio', 'policy size limit');
  assert.equal(harness.fetchImpl.calls.length, 1, 'only the policy GET happens');
  assert.equal(harness.reads.length, 1);
});

test('the configured size limit rejects the blob before any policy request', async () => {
  const harness = makeHarness({ maxBytes: 4, plan: [() => policyResponse()] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'invalid_audio', 'configured size limit');
  assert.equal(harness.fetchImpl.calls.length, 0, 'config limit must reject before the policy GET');
  assert.equal(harness.reads.length, 1);
});

// --- Invalid asset, media type, storage key, blob -------------------------

test('invalid assets are rejected before any read or request', async () => {
  const badAssets = [
    { asset_id: '', media_type: 'audio/wav', duration_ms: 4000, sample_rate_hz: 16000, channels: 1 },
    { asset_id: 'a', media_type: 'video/mp4', duration_ms: 4000, sample_rate_hz: null, channels: null },
    { asset_id: 'a', media_type: 'audio/wav', duration_ms: -1, sample_rate_hz: null, channels: null },
    { asset_id: 'a', media_type: 'audio/wav', duration_ms: 4000, sample_rate_hz: 0, channels: null },
    null,
    'asset',
  ];
  for (const bad of badAssets) {
    const harness = makeHarness();
    const result = await invoke(harness.adapter, { audio: { asset: bad, storage_key: STORAGE_KEY } });
    expectFailure(result, 'invalid_audio', `asset ${JSON.stringify(bad)}`);
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.fetchImpl.calls.length, 0);
  }
});

test('unsupported media types and unsafe storage keys are rejected without network', async () => {
  for (const media of ['audio/x-aiff', 'audio/midi', 'application/octet-stream']) {
    const harness = makeHarness();
    const result = await invoke(harness.adapter, { audio: { asset: asset({ media_type: media }), storage_key: STORAGE_KEY } });
    expectFailure(result, 'invalid_audio', `mime ${media}`);
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.fetchImpl.calls.length, 0);
  }
  const badKeys = ['', 'a/b', '../x', 'C:\\tmp\\x.wav', '.hidden', 'a b', 'a\u0000b', 'k'.repeat(129), 42, null, undefined];
  for (const key of badKeys) {
    const harness = makeHarness();
    const result = await invoke(harness.adapter, { audio: { asset: asset(), storage_key: key } });
    expectFailure(result, 'invalid_audio', `key ${JSON.stringify(key)}`);
    assertSafe(result.error);
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.fetchImpl.calls.length, 0);
  }
});

test('empty, mismatched and non-blob reads are rejected after the read without network', async () => {
  const blobs = [wavBlob(new Uint8Array(0)), wavBlob(WAV_BYTES, 'audio/mpeg'), wavBlob(WAV_BYTES, '')];
  for (const blob of blobs) {
    const harness = makeHarness({ blob });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'invalid_audio', `blob ${blob.type === '' ? 'empty-type' : blob.type}`);
    assert.equal(harness.reads.length, 1);
    assert.equal(harness.fetchImpl.calls.length, 0);
  }
  const harness = makeHarness({ readAudio: () => Promise.resolve({ not: 'a blob' }) });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'invalid_audio', 'non-blob read');
  assert.equal(harness.fetchImpl.calls.length, 0);
});

// --- Model mismatch -------------------------------------------------------

test('a model other than the adapter model is rejected before any read or request', async () => {
  for (const model of ['qwen3-asr-flash', 'Qwen3-asr-flash-filetrans', '', 'other-model']) {
    const harness = makeHarness();
    const result = await invoke(harness.adapter, { model });
    expectFailure(result, 'model_mismatch', `model ${model}`);
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.fetchImpl.calls.length, 0);
  }
});

// --- Constructor configuration -------------------------------------------

test('invalid constructor options throw one static configuration error without leaking the key', () => {
  const LEAKY = 'test-api-key-DO-NOT-LEAK';
  const base = { apiKey: KEY, readAudio: () => Promise.resolve(wavBlob()), maxBytes: 1000, timeoutMs: 1000 };
  const cases = [
    ['apiKey empty', { ...base, apiKey: '' }],
    ['apiKey CRLF', { ...base, apiKey: 'test\r\nkey' }],
    ['apiKey control', { ...base, apiKey: `test${String.fromCharCode(1)}key` }],
    ['apiKey non-string', { ...base, apiKey: 123 }],
    ['readAudio missing', { ...base, readAudio: undefined }],
    ['maxBytes zero', { ...base, maxBytes: 0 }],
    ['maxBytes negative', { ...base, maxBytes: -1 }],
    ['maxBytes fractional', { ...base, maxBytes: 1.5 }],
    ['maxBytes unsafe', { ...base, maxBytes: Number.MAX_SAFE_INTEGER + 2 }],
    ['maxBytes string', { ...base, maxBytes: '1000' }],
    ['timeoutMs zero', { ...base, timeoutMs: 0 }],
    ['timeoutMs fractional', { ...base, timeoutMs: 1.5 }],
    ['timeoutMs too large', { ...base, timeoutMs: 2147483648 }],
    ['fetch not a function', { ...base, fetch: 5 }],
    ['now not a function', { ...base, now: 'now' }],
    ['objectId not a function', { ...base, objectId: {} }],
    ['options null', null],
  ];
  for (const [label, options] of cases) {
    assert.throws(() => new AlibabaTemporaryPublication(options), (error) => {
      assert.ok(error instanceof Error, `${label}: must be an Error`);
      assert.equal(error.message, CONFIG_MESSAGE, `${label}: static message`);
      return true;
    }, label);
  }
  assert.throws(() => new AlibabaTemporaryPublication({ ...base, apiKey: LEAKY, maxBytes: 0 }), (error) => {
    assert.equal(error.message, CONFIG_MESSAGE);
    assert.ok(!String(error.message).includes(LEAKY), 'message must not contain the rejected key');
    assert.ok(!String(error.stack).includes(LEAKY), 'stack must not contain the rejected key');
    return true;
  }, 'leaky key');
  assert.doesNotThrow(() => new AlibabaTemporaryPublication(base), 'valid options must construct without network');
});

// --- Policy host, directory, fields --------------------------------------

test('unapproved upload hosts are rejected without a POST', async () => {
  const hosts = [
    'http://mutsumi-demo.oss-cn-beijing.aliyuncs.com',
    'ftp://mutsumi-demo.oss-cn-beijing.aliyuncs.com',
    'https://user:pass@mutsumi-demo.oss-cn-beijing.aliyuncs.com',
    'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com:8443',
    'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com.attacker.example',
    'https://oss-cn-beijing.aliyuncs.com',
    'https://mutsumi-demo.oss-cn-hangzhou.aliyuncs.com',
    'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com/?x=1',
    'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com/#frag',
    'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com/extra',
    'not-a-url',
    '',
  ];
  for (const host of hosts) {
    const harness = makeHarness({ plan: [() => policyResponse({ upload_host: host })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `host ${host}`);
    assert.equal(harness.fetchImpl.calls.length, 1, `host ${host}: no POST`);
  }
});

test('malformed upload_dir prefixes are rejected without a POST', async () => {
  const dirs = ['', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', '.', '..', 'a\\b', 'a\u0000b', `a${String.fromCharCode(31)}b`];
  for (const dir of dirs) {
    const harness = makeHarness({ plan: [() => policyResponse({ upload_dir: dir })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `dir ${JSON.stringify(dir)}`);
    assert.equal(harness.fetchImpl.calls.length, 1, `dir ${JSON.stringify(dir)}: no POST`);
  }
});

test('policy ACL and overwrite flag must match the documented literals', async () => {
  const overrides = [
    { x_oss_object_acl: 'public-read' }, { x_oss_object_acl: 'Private' },
    { x_oss_object_acl: '' }, { x_oss_object_acl: true },
    { x_oss_forbid_overwrite: true }, { x_oss_forbid_overwrite: 'True' },
    { x_oss_forbid_overwrite: 'false' }, { x_oss_forbid_overwrite: '' },
    { policy: '' }, { policy: 42 }, { signature: '' },
    { oss_access_key_id: '' }, { upload_dir: '' }, { upload_host: '' },
  ];
  for (const over of overrides) {
    const harness = makeHarness({ plan: [() => policyResponse(over)] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', JSON.stringify(over));
    assert.equal(harness.fetchImpl.calls.length, 1, `${JSON.stringify(over)}: no POST`);
  }
});

test('missing policy fields fail safely without a POST', async () => {
  const fields = ['policy', 'signature', 'upload_dir', 'upload_host', 'oss_access_key_id', 'x_oss_object_acl', 'x_oss_forbid_overwrite'];
  for (const field of fields) {
    const harness = makeHarness({ plan: [() => jsonResponse({ data: without(policyData(), field) })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `missing ${field}`);
    assert.equal(harness.fetchImpl.calls.length, 1);
  }
});

test('invalid policy JSON and non-object roots fail safely', async () => {
  const bodies = ['not json {', '', '[]', '"text"', '{}', '{"data":null}', '{"data":[]}', '{"data":"x"}'];
  for (const body of bodies) {
    const harness = makeHarness({ plan: [() => new Response(body, { status: 200 })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `body ${JSON.stringify(body)}`);
    assertSafe(result.error);
  }
});

test('invalid generated objectId is rejected without a POST', async () => {
  for (const id of ['', 'bad/id', '..', 'has space', 'x'.repeat(129), 'ok!', 42, undefined]) {
    const harness = makeHarness({ objectId: () => id });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `objectId ${JSON.stringify(id)}`);
    assert.equal(harness.fetchImpl.calls.length, 1, `objectId ${JSON.stringify(id)}: no POST`);
  }
  const harness = makeHarness({ objectId: () => { throw new Error('objectId source failed'); } });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'throwing objectId');
  assertSafe(result.error);
});

// --- Expiry, clock and slow bodies ---------------------------------------

test('expired upload policy and rewound clock reject before the POST', async () => {
  let expiredReads = 0;
  const expired = makeHarness({ now: () => (expiredReads++ === 0 ? T0 : T0 + 300_000) });
  const expiredResult = await invoke(expired.adapter);
  expectFailure(expiredResult, 'publication_failed', 'expired policy');
  assert.equal(expired.fetchImpl.calls.length, 1, 'expired policy must not POST');

  let rewoundReads = 0;
  const rewound = makeHarness({ now: () => (rewoundReads++ === 0 ? T0 : T0 - 1) });
  const rewoundResult = await invoke(rewound.adapter);
  expectFailure(rewoundResult, 'publication_failed', 'rewound clock');
  assert.equal(rewound.fetchImpl.calls.length, 1, 'rewound clock must not POST');
});

test('upload-credential TTL is measured from response arrival, not body completion', async () => {
  let clock = T0;
  let pulled = false;
  let clockAtFetchCall = null;
  const body = new ReadableStream({
    pull(controller) {
      pulled = true;
      clock += 300_000;
      controller.enqueue(new TextEncoder().encode(JSON.stringify(policyPayload())));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const harness = makeHarness({
    now: () => clock,
    plan: [() => { clockAtFetchCall = clock; return new Response(body, { status: 200 }); }],
  });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'slow policy body');
  assert.equal(harness.fetchImpl.calls.length, 1, 'expired credential must not POST');
  assert.equal(clockAtFetchCall, T0, 'the body stream must not be pre-pulled before arrival');
  assert.equal(pulled, true, 'the policy body must be read');
  assert.equal(clock, T0 + 300_000);
});

test('an invalid clock before the policy body is read still releases the response body', async () => {
  let cancelled = false;
  let pulled = false;
  const body = new ReadableStream({
    pull() { pulled = true; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const harness = makeHarness({
    now: () => Number.NaN,
    plan: [() => new Response(body, { status: 200 })],
  });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'invalid clock');
  await settle();
  assert.equal(cancelled, true, 'the unread policy body must be cancelled/released');
  assert.equal(pulled, false, 'the body must not be consumed');
});

// --- HTTP and body failures ----------------------------------------------

test('non-200 policy and upload responses fail safely and release their bodies', async () => {
  for (const status of [400, 401, 500, 503]) {
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const harness = makeHarness({ plan: [() => new Response(body, { status })] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `policy status ${status}`);
    assertSafe(result.error);
    await settle();
    assert.equal(cancelled, true, `policy status ${status}: body released`);
    assert.equal(harness.fetchImpl.calls.length, 1);
  }

  let uploadCancelled = false;
  const uploadBody = new ReadableStream({ pull() {}, cancel() { uploadCancelled = true; } }, { highWaterMark: 0 });
  const harness = makeHarness({ plan: [() => policyResponse(), () => new Response(uploadBody, { status: 500 })] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'upload status 500');
  await settle();
  assert.equal(uploadCancelled, true, 'upload error body released');
  assert.equal(harness.fetchImpl.calls.length, 2);
});

test('oversized or invalid Content-Length fails safely and releases the body', async () => {
  for (const value of ['70000', 'abc', '-1']) {
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const response = new Response(body, { status: 200, headers: { 'content-length': value } });
    const harness = makeHarness({ plan: [() => response] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'publication_failed', `content-length ${value}`);
    await settle();
    assert.equal(cancelled, true, `content-length ${value}: body released`);
  }
});

test('a streamed policy body over 64KiB with no Content-Length fails and is cancelled', async () => {
  let cancelled = false;
  const chunk = new Uint8Array(30_000);
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk.slice()); },
    cancel() { cancelled = true; },
  });
  const harness = makeHarness({ plan: [() => new Response(body, { status: 200 })] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'streamed oversized body');
  await settle();
  assert.equal(cancelled, true, 'the partially read body must be released');
});

test('dependency exceptions and rejection causes never leak into the failure', async () => {
  const secret = 'provider-body-secret /home/user/private/clip.wav internal.example';

  const readHarness = makeHarness({ readAudio: () => Promise.reject(new Error(secret)) });
  const readResult = await invoke(readHarness.adapter);
  expectFailure(readResult, 'publication_failed', 'read rejection');
  assertSafe(readResult.error);
  assert.equal(readHarness.fetchImpl.calls.length, 0);

  const fetchHarness = makeHarness({ plan: [() => Promise.reject(new Error(secret))] });
  const fetchResult = await invoke(fetchHarness.adapter);
  expectFailure(fetchResult, 'publication_failed', 'fetch rejection');
  assertSafe(fetchResult.error);
});

test('an unrelated external TimeoutError stays publication_failed', async () => {
  const makeTimeout = () => {
    const error = new Error('internal socket timed out');
    error.name = 'TimeoutError';
    return error;
  };
  const readHarness = makeHarness({ readAudio: () => { throw makeTimeout(); } });
  const readResult = await invoke(readHarness.adapter);
  expectFailure(readResult, 'publication_failed', 'read TimeoutError');
  assertSafe(readResult.error);
  assert.equal(readHarness.fetchImpl.calls.length, 0);

  const fetchHarness = makeHarness({ plan: [() => { throw makeTimeout(); }] });
  const fetchResult = await invoke(fetchHarness.adapter);
  expectFailure(fetchResult, 'publication_failed', 'fetch TimeoutError');
  assertSafe(fetchResult.error);
});

// --- Cancellation and deadlines ------------------------------------------

test('a pre-aborted caller is cancelled with no side effects', async () => {
  const controller = new AbortController();
  controller.abort();
  const harness = makeHarness();
  const input = storedAudio();
  const before = JSON.stringify(input);
  const result = await invoke(harness.adapter, { audio: input, signal: controller.signal });
  expectFailure(result, 'cancelled', 'pre-aborted');
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.fetchImpl.calls.length, 0);
  assert.equal(JSON.stringify(input), before);
});

test('caller cancellation during the local read is cancelled with no POST', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const harness = makeHarness({ readAudio: () => new Promise(() => {}) });
  const running = invoke(harness.adapter, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const result = await running;
  expectFailure(result, 'cancelled', 'mid-read');
  assert.equal(harness.fetchImpl.calls.length, 0);
});

test('caller cancellation during the policy request is cancelled with no POST', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const harness = makeHarness({ plan: [() => new Promise(() => {})] });
  const running = invoke(harness.adapter, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const result = await running;
  expectFailure(result, 'cancelled', 'mid-fetch');
  assert.equal(harness.fetchImpl.calls.length, 1);
});

test('caller cancellation during the policy body read is cancelled and releases the body', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const harness = makeHarness({ plan: [() => new Response(body, { status: 200 })] });
  const running = invoke(harness.adapter, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const result = await running;
  expectFailure(result, 'cancelled', 'mid-body');
  assert.equal(harness.fetchImpl.calls.length, 1);
  await settle();
  assert.equal(cancelled, true, 'the partially read body must be released on abort');
});

test('own deadline times out even when the local reader ignores the signal', { timeout: 2000 }, async () => {
  const harness = makeHarness({ timeoutMs: 20, readAudio: () => new Promise(() => {}) });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'timed_out', 'read deadline');
  assert.equal(harness.fetchImpl.calls.length, 0);
});

test('own deadline times out even when the policy request ignores the signal', { timeout: 2000 }, async () => {
  const harness = makeHarness({ timeoutMs: 20, plan: [() => new Promise(() => {})] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'timed_out', 'fetch deadline');
  assert.equal(harness.fetchImpl.calls.length, 1);
});

test('own deadline times out even when the policy body read ignores the signal', { timeout: 2000 }, async () => {
  const body = new ReadableStream({ pull() {} }, { highWaterMark: 0 });
  const harness = makeHarness({ timeoutMs: 20, plan: [() => new Response(body, { status: 200 })] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'timed_out', 'body deadline');
  assert.equal(harness.fetchImpl.calls.length, 1);
});

// --- Cleanup robustness ---------------------------------------------------

test('cleanup does not hang when the stream cancel() promise never settles', { timeout: 2000 }, async () => {
  let cancelCalled = false;
  const body = new ReadableStream({
    pull() {},
    cancel() { cancelCalled = true; return new Promise(() => {}); },
  }, { highWaterMark: 0 });
  const harness = makeHarness({ plan: [() => new Response(body, { status: 500 })] });
  const result = await invoke(harness.adapter);
  expectFailure(result, 'publication_failed', 'never-settling cancel');
  await settle();
  assert.equal(cancelCalled, true);
});

test('a late policy response after caller abort is released and cannot succeed', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  let cancelled = false;
  const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const harness = makeHarness({ plan: [() => pending] });
  const running = invoke(harness.adapter, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const result = await running;
  expectFailure(result, 'cancelled', 'late response');
  resolveFetch(new Response(body, { status: 200 }));
  await settle();
  assert.equal(cancelled, true, 'the late response body is released best effort');
});

test('a losing dependency promise that rejects after abort produces no unhandled rejection', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectFetch;
    const pending = new Promise((_, reject) => { rejectFetch = reject; });
    const harness = makeHarness({ plan: [() => pending] });
    const running = invoke(harness.adapter, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const result = await running;
    expectFailure(result, 'cancelled', 'losing promise');
    rejectFetch(new Error('late provider failure'));
    await settle();
    await settle();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});
