// M02d independent acceptance tests for the Alibaba qwen3-asr-flash-filetrans
// asynchronous analysis adapter (AudioAnalysisPort implementation).
//
// Synthetic only: no real audio, credentials, private media, outbound network,
// filesystem reads or ASR work. Every request goes through an injected mock
// fetch and every wait through an injected sleep, so each case is deterministic.
// Failures are checked against the public AnalysisFailure contract: a plain
// record with exactly code/message/retryable/stage, stage "transcription",
// retryable false, a static message and no cause, key, URL or raw payload.
//
// These cases encode the acceptance requirements themselves, not the current
// source: a defect is reported as a failing test rather than widened into a
// weaker expectation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AlibabaFiletransAnalysis } from '../../apps/server/src/providers/aliyun/filetrans-analysis.ts';
import { FILETRANS_MODEL } from '../../apps/server/src/providers/aliyun/filetrans-result.ts';

const KEY = 'test-api-key';
const T0 = 1_800_000_000_000;
const SUBMIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const TASKS_PREFIX = 'https://dashscope.aliyuncs.com/api/v1/tasks/';
const RESULT_HOST = 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com';
const RESULT_PATH = '/results/transcript.json';
const RESULT_QUERY = 'Expires=1800000000&Signature=signed-query-token';
const RESULT_URL_HTTP = `http://${RESULT_HOST}${RESULT_PATH}?${RESULT_QUERY}`;
const RESULT_URL_HTTPS = `https://${RESULT_HOST}${RESULT_PATH}?${RESULT_QUERY}`;
const OSS_URI = 'oss://dashscope/uploads/obj-01.wav';
const PUBLIC_URI = 'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com/public/clip.wav?Expires=1800000000&Signature=public-query-token';
const TASK_ID = 'task-01_aB-9';
const TIMING_SOURCE = `aliyun:${FILETRANS_MODEL}`;
const MAX_STATUS_JSON_BYTES = 64 * 1024;

const FAILURE_KEYS = ['code', 'message', 'retryable', 'stage'];
const LEAK_MARKERS = [
  KEY,
  'signed-query-token',
  'public-query-token',
  'private-token',
  'signed-url',
  'private payload',
  'provider-body-secret',
  'dashscope.aliyuncs.com',
  RESULT_HOST,
  'oss-cn-beijing',
  'obj-01.wav',
  'cause',
];

// --- Fixtures -------------------------------------------------------------

const asset = (over = {}) => ({
  asset_id: 'asset-1',
  media_type: 'audio/wav',
  duration_ms: 4000,
  sample_rate_hz: 16000,
  channels: 1,
  ...over,
});

const ossRef = (over = {}) => ({
  uri: OSS_URI,
  model: FILETRANS_MODEL,
  expires_at_ms: null,
  transport: 'oss-resource',
  ...over,
});

const httpsRef = (over = {}) => ({
  uri: PUBLIC_URI,
  model: FILETRANS_MODEL,
  expires_at_ms: null,
  transport: 'https',
  ...over,
});

const without = (object, key) => {
  const copy = { ...object };
  delete copy[key];
  return copy;
};

const jsonResponse = (payload, status = 200, headers = {}) =>
  new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const submitPayload = (taskStatus = 'PENDING', outputOver = {}) => ({
  request_id: 'req-synthetic',
  output: { task_id: TASK_ID, task_status: taskStatus, ...outputOver },
});

const pollPayload = (taskStatus, outputOver = {}) => ({
  request_id: 'req-synthetic',
  output: { task_id: TASK_ID, task_status: taskStatus, ...outputOver },
});

const word = (text, beginTime, endTime, extra = {}) => ({
  begin_time: beginTime,
  end_time: endTime,
  text,
  ...extra,
});

const transcriptRaw = (sentenceOver = {}) => ({
  transcripts: [
    {
      channel_id: 0,
      text: '你好。',
      sentences: [
        {
          begin_time: 0,
          end_time: 1000,
          text: '你好。',
          emotion: 'joy',
          words: [word('你', 0, 400), word('好', 400, 900)],
          ...sentenceOver,
        },
      ],
    },
  ],
});

const silentRaw = () => ({ transcripts: [{ channel_id: 0, text: '', sentences: [] }] });

const noWordsRaw = () => {
  const raw = transcriptRaw();
  delete raw.transcripts[0].sentences[0].words;
  return raw;
};

const badTimingRaw = () => transcriptRaw({ words: [word('你', 0, 400), word('好', 900, 9000)] });

const hostileFailure = () => ({
  code: 'cancelled',
  stage: 'transcription',
  retryable: false,
  message: 'private-token signed-url',
  cause: 'private payload',
});

const resultSuccess = (url = RESULT_URL_HTTP) =>
  submitPayload('SUCCEEDED', { result: { transcription_url: url } });

// --- Harness --------------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const drain = async () => {
  await tick();
  await tick();
};

function makeHarness(config = {}) {
  const plan = config.plan ?? [];
  const sleeps = [];
  const sleep =
    config.sleep ??
    ((ms, signal) => {
      sleeps.push({ ms, signal });
      return Promise.resolve();
    });
  const fetchImpl = (url, init) => {
    const index = fetchImpl.calls.length;
    fetchImpl.calls.push({ url: typeof url === 'string' ? url : String(url), init });
    const step = plan[Math.min(index, plan.length - 1)];
    return Promise.resolve(typeof step === 'function' ? step(index) : step);
  };
  fetchImpl.calls = [];
  const adapter = new AlibabaFiletransAnalysis({
    apiKey: config.apiKey ?? KEY,
    timeoutMs: config.timeoutMs ?? 1000,
    pollIntervalMs: config.pollIntervalMs ?? 250,
    maxPolls: config.maxPolls ?? 8,
    maxResultBytes: config.maxResultBytes ?? 8192,
    fetch: fetchImpl,
    now: config.now ?? (() => T0),
    sleep,
  });
  return { adapter, fetchImpl, sleeps };
}

async function invoke(adapter, options = {}) {
  const { audio = asset(), remote = ossRef(), signal } = options;
  const controller = signal === undefined ? new AbortController() : null;
  try {
    const value = await adapter.analyze(audio, remote, { signal: signal ?? controller.signal });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function expectFailure(result, code, note = 'case') {
  assert.equal(result.ok, false, `${note}: expected ${code}, received success ${JSON.stringify(result.value)}`);
  const error = result.error;
  assert.ok(typeof error === 'object' && error !== null && !Array.isArray(error), `${note}: failure must be an object`);
  assert.equal(error instanceof Error, false, `${note}: failure must be a plain record, not an Error`);
  assert.deepEqual(Object.keys(error).sort(), FAILURE_KEYS, `${note}: failure keys (no foreign cause or raw fields)`);
  assert.equal(error.code, code, `${note}: code`);
  assert.equal(error.stage, 'transcription', `${note}: stage`);
  assert.equal(error.retryable, false, `${note}: retryable`);
  assert.ok(typeof error.message === 'string' && error.message.length > 0, `${note}: message`);
  assert.ok(!error.message.includes(KEY), `${note}: message must not contain the API key`);
  return error;
}

function assertSafe(error) {
  const text = JSON.stringify(error);
  for (const marker of LEAK_MARKERS) {
    assert.ok(!text.includes(marker), `failure leaked "${marker}": ${text}`);
  }
}

function assertNoCredentials(init) {
  const headers = init.headers;
  if (headers === undefined || headers === null) return;
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  assert.ok(!names.includes('authorization'), 'the request must not carry API authorization');
  assert.ok(!names.some((name) => name.startsWith('x-dashscope-')), 'the request must not carry DashScope headers');
}

const bodyOf = (response) => response.body;

// --- Submit -> poll -> result ---------------------------------------------

describe('filetrans analysis: approved submit, poll and result exchange', () => {
  test('PENDING submit, RUNNING poll and SUCCEEDED poll map real word timing and emotion', async () => {
    const harness = makeHarness({
      pollIntervalMs: 250,
      plan: [
        () => jsonResponse(submitPayload('PENDING')),
        () => jsonResponse(pollPayload('RUNNING')),
        () => jsonResponse(pollPayload('SUCCEEDED', { result: { transcription_url: RESULT_URL_HTTP } })),
        () => jsonResponse(transcriptRaw()),
      ],
    });

    const result = await invoke(harness.adapter, { remote: ossRef() });
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);

    const calls = harness.fetchImpl.calls;
    assert.equal(calls.length, 4, 'one submit, two polls, one result download');
    assert.equal(calls.filter((call) => call.init.method === 'POST').length, 1, 'exactly one POST');

    const [submit, poll1, poll2, download] = calls;
    assert.equal(submit.url, SUBMIT_URL, 'fixed asynchronous submission endpoint');
    assert.equal(submit.init.method, 'POST');
    assert.equal(submit.init.redirect, 'error');
    assert.deepEqual(submit.init.headers, {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    });
    assert.deepEqual(JSON.parse(submit.init.body), {
      model: FILETRANS_MODEL,
      input: { file_url: OSS_URI },
      parameters: { channel_id: [0], enable_itn: false, enable_words: true },
    });

    assert.equal(poll1.url, `${TASKS_PREFIX}${TASK_ID}`);
    assert.equal(poll2.url, `${TASKS_PREFIX}${TASK_ID}`);
    assert.equal(poll1.init.method, 'GET');
    assert.equal(poll1.init.redirect, 'error');
    assert.deepEqual(poll1.init.headers, { Authorization: `Bearer ${KEY}` });

    assert.equal(download.url, RESULT_URL_HTTPS, 'http result URL is upgraded to https with path and query kept');
    assert.equal(download.init.method, 'GET');
    assert.equal(download.init.redirect, 'error');
    assertNoCredentials(download.init);

    assert.ok(submit.init.signal instanceof AbortSignal, 'requests carry an AbortSignal');
    for (const call of calls) assert.equal(call.init.signal, submit.init.signal, 'every request shares one signal');
    assert.deepEqual(harness.sleeps.map((entry) => entry.ms), [250, 250], 'configured interval before every poll GET');
    for (const entry of harness.sleeps) {
      assert.equal(entry.signal, submit.init.signal, 'the polling wait shares the request signal');
    }

    const document = result.value;
    assert.equal(document.asset_id, 'asset-1');
    assert.equal(document.transcript, '你好。');
    assert.deepEqual(
      document.segments.map((segment) => [segment.text, segment.timing.start_ms, segment.timing.end_ms, segment.timing.source]),
      [['你好。', 0, 1000, TIMING_SOURCE]],
    );
    assert.deepEqual(
      document.segments[0].units.map((unit) => [unit.text, unit.timing.start_ms, unit.timing.end_ms]),
      [['你', 0, 400], ['好', 400, 900]],
    );
    assert.deepEqual(
      document.observations.map((observation) => [observation.kind, observation.label, observation.segment_ids]),
      [['emotion', 'joy', ['seg-0']]],
    );
    assert.equal(document.capabilities.word_timing.status, 'ok');
  });

  test('a public https OSS reference submits without the OSS resolve header and an immediate success never polls', async () => {
    const harness = makeHarness({
      plan: [
        () => jsonResponse(resultSuccess(RESULT_URL_HTTPS)),
        () => jsonResponse(transcriptRaw()),
      ],
    });

    const result = await invoke(harness.adapter, { remote: httpsRef() });
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    assert.equal(harness.fetchImpl.calls.length, 2, 'an immediate success needs no poll');
    assert.equal(harness.sleeps.length, 0, 'an immediate success never waits');

    const submit = harness.fetchImpl.calls[0];
    assert.deepEqual(submit.init.headers, {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    });
    assert.deepEqual(JSON.parse(submit.init.body).input, { file_url: PUBLIC_URI });
    assert.equal(harness.fetchImpl.calls[1].url, RESULT_URL_HTTPS, 'an https result URL is accepted unchanged');
  });

  test('an http result URL on the approved host is upgraded to https with path and signed query intact', async () => {
    const signed = `http://${RESULT_HOST}/deep/path/out%20put.json?Expires=1800000000&OSSAccessKeyId=sts-synthetic&Signature=abc%2Fdef%3D`;
    const harness = makeHarness({
      plan: [() => jsonResponse(resultSuccess(signed)), () => jsonResponse(transcriptRaw())],
    });

    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    const download = harness.fetchImpl.calls[1];
    assert.equal(
      download.url,
      `https://${RESULT_HOST}/deep/path/out%20put.json?Expires=1800000000&OSSAccessKeyId=sts-synthetic&Signature=abc%2Fdef%3D`,
    );
    assert.equal(download.init.redirect, 'error');
    assertNoCredentials(download.init);
  });
});

// --- Reference and asset validation --------------------------------------

describe('filetrans analysis: validation happens before any request', () => {
  test('an invalid asset is invalid_audio before any request', async () => {
    const badAssets = [
      null,
      'asset',
      {},
      asset({ asset_id: '' }),
      asset({ media_type: 'video/mp4' }),
      asset({ duration_ms: -1 }),
      asset({ duration_ms: 0 }),
      asset({ sample_rate_hz: 0 }),
      asset({ channels: -2 }),
      asset({ unexpected_key: 'not part of the contract' }),
    ];
    for (const bad of badAssets) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { audio: bad });
      expectFailure(result, 'invalid_audio', `asset ${JSON.stringify(bad)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `${JSON.stringify(bad)}: no request`);
      assert.equal(harness.sleeps.length, 0);
    }
  });

  test('a remote model other than the adapter model is model_mismatch before any request', async () => {
    for (const model of ['qwen3-asr-flash', 'Qwen3-Asr-Flash-Filetrans', '', 'other-model', 42, undefined]) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { remote: ossRef({ model }) });
      expectFailure(result, 'model_mismatch', `model ${JSON.stringify(model)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `model ${JSON.stringify(model)}: no request`);
    }
  });

  test('the asset is validated before the remote model is checked', async () => {
    const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
    const result = await invoke(harness.adapter, {
      audio: asset({ asset_id: '' }),
      remote: ossRef({ model: 'other-model' }),
    });
    expectFailure(result, 'invalid_audio', 'asset first');
    assert.equal(harness.fetchImpl.calls.length, 0);
  });

  test('unknown transports and missing reference fields are invalid_audio without a request', async () => {
    const badRefs = [
      ossRef({ transport: 'sftp' }),
      ossRef({ transport: 'OSS-RESOURCE' }),
      without(ossRef(), 'transport'),
      ossRef({ uri: '' }),
      without(ossRef(), 'uri'),
      ossRef({ transport: 'https' }),
      httpsRef({ transport: 'oss-resource' }),
      null,
      'reference',
      42,
    ];
    for (const remote of badRefs) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { remote });
      expectFailure(result, 'invalid_audio', `reference ${JSON.stringify(remote)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `reference ${JSON.stringify(remote)}: no request`);
    }
  });

  test('oss-resource references must be a safe slash-separated object key', async () => {
    const badUris = [
      'oss://dashscope//obj.wav',
      'oss://dashscope/./obj.wav',
      'oss://dashscope/../obj.wav',
      'oss://dashscope/..',
      'oss://.',
      'oss://',
      'oss:///obj.wav',
      'oss://dashscope/',
      'oss://dashscope\\obj.wav',
      'oss://dashscope/obj.wav?x=1',
      'oss://dashscope/obj.wav#frag',
      'oss://user@dashscope/obj.wav',
      `oss://dashscope/obj${String.fromCharCode(0)}.wav`,
      'oss:/dashscope/obj.wav',
      'dashscope/obj.wav',
      PUBLIC_URI,
    ];
    for (const uri of badUris) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { remote: ossRef({ uri }) });
      expectFailure(result, 'invalid_audio', `oss uri ${JSON.stringify(uri)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `${JSON.stringify(uri)}: no request`);
    }
  });

  test('a safe oss-resource key with nested directories is accepted', async () => {
    const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('FAILED'))] });
    const result = await invoke(harness.adapter, { remote: ossRef({ uri: 'oss://dashscope/uploads/2026/10/obj-01.wav' }) });
    expectFailure(result, 'provider_failed', 'oss key accepted');
    assert.equal(harness.fetchImpl.calls.length, 1, 'an accepted reference reaches the provider');
  });

  test('https references must be a public https Alibaba OSS location with no userinfo, port, hash or foreign host', async () => {
    const badUris = [
      'http://mutsumi-demo.oss-cn-beijing.aliyuncs.com/x',
      'https://user:pass@mutsumi-demo.oss-cn-beijing.aliyuncs.com/x',
      'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com:8443/x',
      'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com/x#frag',
      'https://mutsumi-demo.oss-cn-beijing.aliyuncs.com.attacker.example/x',
      'https://oss-cn-beijing.aliyuncs.com/x',
      'https://mutsumi-demo.oss-cn-beijing-internal.aliyuncs.com/x',
      'https://mutsumi-demo.s3.amazonaws.com/x',
      'ftp://mutsumi-demo.oss-cn-beijing.aliyuncs.com/x',
      'not-a-url',
      '',
      OSS_URI,
    ];
    for (const uri of badUris) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { remote: httpsRef({ uri }) });
      expectFailure(result, 'invalid_audio', `https uri ${JSON.stringify(uri)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `${JSON.stringify(uri)}: no request`);
    }
  });

  test('a public https OSS reference with a signed query and unspecified expiry is accepted', async () => {
    const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('FAILED'))] });
    const result = await invoke(harness.adapter, {
      remote: httpsRef({ uri: PUBLIC_URI, expires_at_ms: null }),
    });
    expectFailure(result, 'provider_failed', 'signed https reference accepted');
    assert.equal(harness.fetchImpl.calls.length, 1, 'an accepted reference reaches the provider');
  });

  test('expiry must be null or a safe future epoch strictly after the injected clock', async () => {
    for (const expiry of [null, T0 + 60_000]) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('FAILED'))] });
      const result = await invoke(harness.adapter, { remote: ossRef({ expires_at_ms: expiry }) });
      expectFailure(result, 'provider_failed', `expiry ${String(expiry)} accepted`);
      assert.equal(harness.fetchImpl.calls.length, 1, `expiry ${String(expiry)}: reaches the provider`);
    }
    const badExpiries = [
      T0,
      T0 - 1,
      -1,
      1.5,
      '1800000000000',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 2,
      undefined,
      true,
    ];
    for (const expiry of badExpiries) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
      const result = await invoke(harness.adapter, { remote: ossRef({ expires_at_ms: expiry }) });
      expectFailure(result, 'invalid_audio', `expiry ${String(expiry)}`);
      assert.equal(harness.fetchImpl.calls.length, 0, `expiry ${String(expiry)}: no request`);
    }
  });
});

// --- Submission -----------------------------------------------------------

describe('filetrans analysis: exactly one billed submission', () => {
  test('non-2xx submission responses are submission_failed, never retried, and release the body', async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      let cancelled = false;
      const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const harness = makeHarness({ plan: [() => new Response(body, { status })] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'submission_failed', `submit ${status}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 1, `submit ${status}: no retry`);
      assert.equal(harness.sleeps.length, 0, `submit ${status}: no polling`);
      await drain();
      assert.equal(cancelled, true, `submit ${status}: error body released`);
    }
  });

  test('a submission connection error is submission_failed with a single POST', async () => {
    const harness = makeHarness({ plan: [() => Promise.reject(new Error('internal socket timed out'))] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'submission_failed', 'connection error');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 1, 'no resubmission');
  });

  test('malformed submission payloads and task identifiers are submission_failed', async () => {
    const bodies = [
      'not json {',
      '',
      '[]',
      '"text"',
      '{}',
      '{"output":null}',
      '{"output":[]}',
      '{"output":{"task_status":"PENDING"}}',
      '{"output":{"task_id":"bad id","task_status":"PENDING"}}',
      `{"output":{"task_id":"${'x'.repeat(129)}","task_status":"PENDING"}}`,
      '{"output":{"task_id":7,"task_status":"PENDING"}}',
      '{"output":{"task_id":"task-01"}}',
      '{"output":{"task_id":"task-01","task_status":"CANCELED"}}',
      '{"output":{"task_id":"task-01","task_status":"succeeded"}}',
      '{"output":{"task_id":"task-01","task_status":null}}',
    ];
    for (const body of bodies) {
      const harness = makeHarness({ plan: [() => new Response(body, { status: 200 })] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'submission_failed', `submit body ${body.slice(0, 64)}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 1, 'a malformed submission never polls');
    }
  });

  test('a submission whose task is already FAILED or UNKNOWN is provider_failed without a poll', async () => {
    for (const status of ['FAILED', 'UNKNOWN']) {
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload(status))] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'provider_failed', `submit ${status}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 1, `submit ${status}: no poll and no retry`);
      assert.equal(harness.sleeps.length, 0, `submit ${status}: no wait`);
    }
  });

  test('a submission body that errors mid-read is submission_failed', async () => {
    const harness = makeHarness({
      plan: [
        () =>
          new Response(
            new ReadableStream({ start(controller) { controller.error(new Error('body read failed')); } }),
            { status: 200 },
          ),
      ],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'submission_failed', 'body error');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 1);
  });

  test('submission status JSON is bounded to 64 KiB on the stream and on Content-Length', async () => {
    let streamedCancel = false;
    const chunk = new Uint8Array(40_000).fill(65);
    const streamed = new ReadableStream(
      {
        pull(controller) { controller.enqueue(chunk.slice()); },
        cancel() { streamedCancel = true; },
      },
    );
    const overshoot = makeHarness({ plan: [() => new Response(streamed, { status: 200 })] });
    const overshootResult = await invoke(overshoot.adapter);
    expectFailure(overshootResult, 'submission_failed', 'streamed overshoot');
    await drain();
    assert.equal(streamedCancel, true, 'the partially read status body must be released');
    assert.equal(overshoot.fetchImpl.calls.length, 1);

    let pulled = false;
    let earlyCancel = false;
    const declaredBody = new ReadableStream(
      { pull() { pulled = true; }, cancel() { earlyCancel = true; } },
      { highWaterMark: 0 },
    );
    const declared = makeHarness({
      plan: [
        () =>
          new Response(declaredBody, {
            status: 200,
            headers: { 'content-length': String(MAX_STATUS_JSON_BYTES + 1) },
          }),
      ],
    });
    const declaredResult = await invoke(declared.adapter);
    expectFailure(declaredResult, 'submission_failed', 'declared overshoot');
    await drain();
    assert.equal(earlyCancel, true, 'a declared oversize body must be released');
    assert.equal(pulled, false, 'a declared oversize body must not be read');
  });

  test('an ambiguous submission timeout never triggers a second billed submit', { timeout: 2000 }, async () => {
    const harness = makeHarness({ timeoutMs: 25, plan: [() => new Promise(() => {})] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timed_out', 'ambiguous submit');
    assert.equal(harness.fetchImpl.calls.length, 1, 'exactly one POST, never a retry');
  });
});

// --- Polling --------------------------------------------------------------

describe('filetrans analysis: polling under one shared deadline', () => {
  test('malformed poll payloads and task id mismatches are invalid_result', async () => {
    const bodies = [
      'not json {',
      '',
      '[]',
      '"text"',
      '{}',
      '{"output":null}',
      '{"output":[]}',
      '{"output":{"task_id":"task-01"}}',
      '{"output":{"task_status":"SUCCEEDED"}}',
      '{"output":{"task_id":"other-task","task_status":"SUCCEEDED"}}',
      '{"output":{"task_id":"task-01","task_status":"queued"}}',
      '{"output":{"task_id":"task-01","task_status":42}}',
      '{"output":{"task_id":"task-01","task_status":"SUCCEEDED","result":{"transcription_url":42}}}',
    ];
    for (const body of bodies) {
      const harness = makeHarness({
        plan: [() => jsonResponse(submitPayload('PENDING')), () => new Response(body, { status: 200 })],
      });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'invalid_result', `poll body ${body.slice(0, 64)}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 2, 'no download after a malformed poll');
    }
  });

  test('FAILED and UNKNOWN polls are provider_failed', async () => {
    for (const status of ['FAILED', 'UNKNOWN']) {
      const harness = makeHarness({
        plan: [() => jsonResponse(submitPayload('PENDING')), () => jsonResponse(pollPayload(status))],
      });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'provider_failed', `poll ${status}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 2, `poll ${status}: no retry`);
    }
  });

  test('poll HTTP errors and connection failures are provider_failed and never resubmit', async () => {
    for (const status of [400, 429, 500, 503]) {
      const harness = makeHarness({
        plan: [
          () => jsonResponse(submitPayload('PENDING')),
          () => new Response('{"code":"Throttling"}', { status }),
        ],
      });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'provider_failed', `poll ${status}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 2, `poll ${status}: no retry`);
      assert.equal(harness.fetchImpl.calls.filter((call) => call.init.method === 'POST').length, 1, `poll ${status}: no resubmission`);
    }

    const reset = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => Promise.reject(new Error('connection reset'))],
    });
    const resetResult = await invoke(reset.adapter);
    expectFailure(resetResult, 'provider_failed', 'poll connection error');
    assertSafe(resetResult.error);
    assert.equal(reset.fetchImpl.calls.length, 2);
  });

  test('a SUCCEEDED poll without a usable transcription_url is invalid_result before any download', async () => {
    const harness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => jsonResponse(pollPayload('SUCCEEDED'))],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'invalid_result', 'missing transcription_url');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 2, 'no download attempt');
  });

  test('the poll budget caps GET requests even when the injected sleep resolves immediately', async () => {
    const harness = makeHarness({
      maxPolls: 3,
      pollIntervalMs: 250,
      plan: [() => jsonResponse(submitPayload('PENDING')), () => jsonResponse(pollPayload('PENDING'))],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timed_out', 'poll budget');
    assert.equal(harness.fetchImpl.calls.length, 4, 'one submit plus exactly three polls');
    assert.equal(harness.sleeps.length, 3, 'one configured wait per poll');
    assert.deepEqual(harness.sleeps.map((entry) => entry.ms), [250, 250, 250]);
  });

  test('poll status JSON is bounded to 64 KiB on the stream and on Content-Length', async () => {
    let streamedCancel = false;
    const chunk = new Uint8Array(40_000).fill(65);
    const streamed = new ReadableStream(
      {
        pull(controller) { controller.enqueue(chunk.slice()); },
        cancel() { streamedCancel = true; },
      },
    );
    const overshoot = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => new Response(streamed, { status: 200 })],
    });
    const overshootResult = await invoke(overshoot.adapter);
    expectFailure(overshootResult, 'invalid_result', 'streamed poll overshoot');
    await drain();
    assert.equal(streamedCancel, true, 'the partially read poll body must be released');

    let pulled = false;
    let earlyCancel = false;
    const declaredBody = new ReadableStream(
      { pull() { pulled = true; }, cancel() { earlyCancel = true; } },
      { highWaterMark: 0 },
    );
    const declared = makeHarness({
      plan: [
        () => jsonResponse(submitPayload('PENDING')),
        () =>
          new Response(declaredBody, {
            status: 200,
            headers: { 'content-length': String(MAX_STATUS_JSON_BYTES + 1) },
          }),
      ],
    });
    const declaredResult = await invoke(declared.adapter);
    expectFailure(declaredResult, 'invalid_result', 'declared poll overshoot');
    await drain();
    assert.equal(earlyCancel, true, 'a declared oversize poll body must be released');
    assert.equal(pulled, false, 'a declared oversize poll body must not be read');
  });

  test('task-level metadata is never used as audio timing', async () => {
    const END_TIME_MARKER = 987654321;
    const harness = makeHarness({
      plan: [
        () => jsonResponse(submitPayload('PENDING')),
        () =>
          jsonResponse(
            pollPayload('SUCCEEDED', {
              result: { transcription_url: RESULT_URL_HTTPS },
              end_time: END_TIME_MARKER,
              submit_time: '2026-10-01T00:00:00Z',
            }),
          ),
        () => jsonResponse(transcriptRaw()),
      ],
    });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    const document = result.value;
    assert.deepEqual(document.segments[0].timing, { status: 'available', start_ms: 0, end_ms: 1000, source: TIMING_SOURCE });
    assert.equal(document.segments[0].units[1].timing.end_ms, 900);
    assert.ok(!JSON.stringify(document).includes(String(END_TIME_MARKER)), 'task end_time must not become audio timing');
  });
});

// --- Result download and mapping -----------------------------------------

describe('filetrans analysis: result download and mapping', () => {
  test('non-approved result URLs are invalid_result before any download', async () => {
    const badUrls = [
      null,
      undefined,
      '',
      42,
      'not-a-url',
      `ftp://${RESULT_HOST}${RESULT_PATH}?${RESULT_QUERY}`,
      `http://user:pass@${RESULT_HOST}${RESULT_PATH}?${RESULT_QUERY}`,
      `http://${RESULT_HOST}:8443${RESULT_PATH}?${RESULT_QUERY}`,
      `http://${RESULT_HOST}${RESULT_PATH}?${RESULT_QUERY}#fragment`,
      `http://evil.example${RESULT_PATH}?${RESULT_QUERY}`,
      `http://${RESULT_HOST}.attacker.example${RESULT_PATH}?${RESULT_QUERY}`,
      `http://mutsumi-demo.oss-cn-beijing-internal.aliyuncs.com${RESULT_PATH}?${RESULT_QUERY}`,
      `http://dashscope.aliyuncs.com${RESULT_PATH}?${RESULT_QUERY}`,
    ];
    for (const url of badUrls) {
      const outputOver = url === null || url === undefined ? {} : { result: { transcription_url: url } };
      const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('SUCCEEDED', outputOver))] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'invalid_result', `result url ${JSON.stringify(url)}`);
      assertSafe(result.error);
      assert.equal(harness.fetchImpl.calls.length, 1, `result url ${JSON.stringify(url)}: no download`);
    }
  });

  test('a non-200 result response is invalid_result and releases the body', async () => {
    for (const status of [403, 404, 500]) {
      let cancelled = false;
      const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const harness = makeHarness({
        plan: [() => jsonResponse(resultSuccess()), () => new Response(body, { status })],
      });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'invalid_result', `result ${status}`);
      assertSafe(result.error);
      await drain();
      assert.equal(cancelled, true, `result ${status}: error body released`);
    }
  });

  test('invalid result JSON and a body that errors are invalid_result', async () => {
    for (const body of ['not json {', '', '[]', '"text"', '{}']) {
      const harness = makeHarness({ plan: [() => jsonResponse(resultSuccess()), () => new Response(body, { status: 200 })] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'invalid_result', `result body ${JSON.stringify(body)}`);
      assertSafe(result.error);
    }

    const errored = makeHarness({
      plan: [
        () => jsonResponse(resultSuccess()),
        () =>
          new Response(
            new ReadableStream({ start(controller) { controller.error(new Error('body read failed')); } }),
            { status: 200 },
          ),
      ],
    });
    const erroredResult = await invoke(errored.adapter);
    expectFailure(erroredResult, 'invalid_result', 'result body error');
    assertSafe(erroredResult.error);
  });

  test('the configured result byte bound is enforced for streamed and declared bodies', async () => {
    let streamedCancel = false;
    const chunk = new Uint8Array(64).fill(65);
    const streamed = new ReadableStream({
      pull(controller) { controller.enqueue(chunk.slice()); },
      cancel() { streamedCancel = true; },
    });
    const overshoot = makeHarness({
      maxResultBytes: 100,
      plan: [() => jsonResponse(resultSuccess()), () => new Response(streamed, { status: 200 })],
    });
    const overshootResult = await invoke(overshoot.adapter);
    expectFailure(overshootResult, 'invalid_result', 'streamed result overshoot');
    await drain();
    assert.equal(streamedCancel, true, 'the partially read result body must be released');

    let pulled = false;
    let earlyCancel = false;
    const declaredBody = new ReadableStream(
      { pull() { pulled = true; }, cancel() { earlyCancel = true; } },
      { highWaterMark: 0 },
    );
    const declared = makeHarness({
      maxResultBytes: 100,
      plan: [
        () => jsonResponse(resultSuccess()),
        () => new Response(declaredBody, { status: 200, headers: { 'content-length': '5000' } }),
      ],
    });
    const declaredResult = await invoke(declared.adapter);
    expectFailure(declaredResult, 'invalid_result', 'declared result overshoot');
    await drain();
    assert.equal(earlyCancel, true, 'a declared oversize result body must be released');
    assert.equal(pulled, false, 'a declared oversize result body must not be read');
  });

  test('a mapper timing_unavailable failure is preserved unchanged', async () => {
    const harness = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => jsonResponse(noWordsRaw())],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timing_unavailable', 'missing measured word timing');
    assertSafe(result.error);
  });

  test('a silent successful transcription is a valid empty document', async () => {
    const harness = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => jsonResponse(silentRaw())],
    });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.transcript, '');
    assert.deepEqual(result.value.segments, []);
    assert.deepEqual(result.value.observations, []);
    assert.equal(result.value.capabilities.word_timing.status, 'ok');
  });

  test('malformed timed output is invalid_result', async () => {
    const harness = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => jsonResponse(badTimingRaw())],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'invalid_result', 'word timing outside its sentence');
    assertSafe(result.error);
  });

  test('the mapped document never carries provider URLs, request ids or signed queries', async () => {
    const harness = makeHarness({
      plan: [
        () => jsonResponse(submitPayload('PENDING')),
        () => jsonResponse(pollPayload('SUCCEEDED', { result: { transcription_url: RESULT_URL_HTTP } })),
        () => jsonResponse(transcriptRaw()),
      ],
    });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    const dump = JSON.stringify(result.value);
    for (const marker of [RESULT_HOST, 'Signature', 'signed-query-token', 'transcription_url', 'req-synthetic', 'dashscope', OSS_URI]) {
      assert.ok(!dump.includes(marker), `mapped document leaked "${marker}"`);
    }
  });
});

// --- Cancellation, deadlines and late settlement --------------------------

describe('filetrans analysis: cancellation and bounded deadlines', () => {
  test('a pre-aborted caller is cancelled without any request', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
    const result = await invoke(harness.adapter, { signal: controller.signal });
    expectFailure(result, 'cancelled', 'pre-aborted');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 0);
    assert.equal(harness.sleeps.length, 0);
  });

  test('caller abort during submission is cancelled and never resubmits', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const harness = makeHarness({ plan: [() => new Promise(() => {})] });
    const running = invoke(harness.adapter, { signal: controller.signal });
    await tick();
    assert.equal(harness.fetchImpl.calls.length, 1, 'the submission is in flight');
    controller.abort();
    const result = await running;
    expectFailure(result, 'cancelled', 'abort during submit');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 1, 'no resubmission after the abort');
  });

  test('caller abort while waiting between polls is cancelled without a poll GET', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const harness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING'))],
      sleep: () => new Promise(() => {}),
    });
    const running = invoke(harness.adapter, { signal: controller.signal });
    await drain();
    assert.equal(harness.fetchImpl.calls.length, 1, 'only the submission happened');
    controller.abort();
    const result = await running;
    expectFailure(result, 'cancelled', 'abort during the poll wait');
    assertSafe(result.error);
    assert.equal(harness.fetchImpl.calls.length, 1, 'no poll GET after the abort');
  });

  test('caller abort during the result body read is cancelled and releases the body', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const harness = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => new Response(body, { status: 200 })],
    });
    const running = invoke(harness.adapter, { signal: controller.signal });
    await drain();
    assert.equal(harness.fetchImpl.calls.length, 2, 'the result download is in flight');
    controller.abort();
    const result = await running;
    expectFailure(result, 'cancelled', 'abort during the result body');
    await drain();
    assert.equal(cancelled, true, 'the partially read result body must be released');
  });

  test('the own deadline bounds a submission request that ignores the signal', { timeout: 2000 }, async () => {
    const harness = makeHarness({ timeoutMs: 25, plan: [() => new Promise(() => {})] });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timed_out', 'submit deadline');
    assert.equal(harness.fetchImpl.calls.length, 1);
  });

  test('the own deadline bounds a polling wait that ignores the signal', { timeout: 2000 }, async () => {
    const harness = makeHarness({
      timeoutMs: 25,
      plan: [() => jsonResponse(submitPayload('PENDING'))],
      sleep: () => new Promise(() => {}),
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timed_out', 'poll wait deadline');
    assert.equal(harness.fetchImpl.calls.length, 1, 'no poll GET before the deadline');
  });

  test('the own deadline bounds a result body that never yields', { timeout: 2000 }, async () => {
    const body = new ReadableStream({ pull() {} }, { highWaterMark: 0 });
    const harness = makeHarness({
      timeoutMs: 25,
      plan: [() => jsonResponse(resultSuccess()), () => new Response(body, { status: 200 })],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'timed_out', 'result body deadline');
    assert.equal(harness.fetchImpl.calls.length, 2);
  });

  test('a submission response that arrives after caller abort is released and cannot succeed', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    let settleFetch;
    const pending = new Promise((resolve) => { settleFetch = resolve; });
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const harness = makeHarness({ plan: [() => pending] });
    const running = invoke(harness.adapter, { signal: controller.signal });
    await tick();
    controller.abort();
    const result = await running;
    expectFailure(result, 'cancelled', 'late submit response');
    settleFetch(new Response(body, { status: 200 }));
    await drain();
    assert.equal(cancelled, true, 'the late response body must be released best effort');
    assert.equal(harness.fetchImpl.calls.length, 1, 'the late response cannot start a poll');
  });

  test('a poll success that arrives after caller abort never becomes a result', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    let settlePoll;
    const pending = new Promise((resolve) => { settlePoll = resolve; });
    const harness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => pending],
    });
    const running = invoke(harness.adapter, { signal: controller.signal });
    await drain();
    assert.equal(harness.fetchImpl.calls.length, 2, 'the first poll is in flight');
    controller.abort();
    const result = await running;
    expectFailure(result, 'cancelled', 'late poll success');
    settlePoll(jsonResponse(pollPayload('SUCCEEDED', { result: { transcription_url: RESULT_URL_HTTP } })));
    await drain();
    assert.equal(harness.fetchImpl.calls.length, 2, 'the late success must not trigger a download');
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
      await tick();
      controller.abort();
      const result = await running;
      expectFailure(result, 'cancelled', 'losing promise');
      rejectFetch(new Error('late provider failure'));
      await drain();
      await drain();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  test('cleanup callbacks that hang or reject stay bounded and silent', { timeout: 2000 }, async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const hanging = new ReadableStream({ pull() {}, cancel() { return new Promise(() => {}); } }, { highWaterMark: 0 });
      const hangingHarness = makeHarness({
        plan: [() => jsonResponse(resultSuccess()), () => new Response(hanging, { status: 500 })],
      });
      const hangingResult = await invoke(hangingHarness.adapter);
      expectFailure(hangingResult, 'invalid_result', 'hanging cancel');

      const rejecting = new ReadableStream(
        { pull() {}, cancel() { return Promise.reject(new Error('cancel failed')); } },
        { highWaterMark: 0 },
      );
      const rejectingHarness = makeHarness({
        plan: [() => jsonResponse(resultSuccess()), () => new Response(rejecting, { status: 500 })],
      });
      const rejectingResult = await invoke(rejectingHarness.adapter);
      expectFailure(rejectingResult, 'invalid_result', 'rejecting cancel');
      await drain();
      await drain();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  test('an external error name alone never becomes an internal timeout or cancellation', async () => {
    const named = (name) => {
      const error = new Error(`internal socket ${name}`);
      error.name = name;
      return error;
    };
    for (const name of ['TimeoutError', 'AbortError', 'NetworkError']) {
      const submitHarness = makeHarness({ plan: [() => { throw named(name); }] });
      const submitResult = await invoke(submitHarness.adapter);
      expectFailure(submitResult, 'submission_failed', `submit ${name}`);
      assertSafe(submitResult.error);

      const pollHarness = makeHarness({
        plan: [() => jsonResponse(submitPayload('PENDING')), () => { throw named(name); }],
      });
      const pollResult = await invoke(pollHarness.adapter);
      expectFailure(pollResult, 'provider_failed', `poll ${name}`);
      assertSafe(pollResult.error);

      const downloadHarness = makeHarness({
        plan: [() => jsonResponse(resultSuccess()), () => { throw named(name); }],
      });
      const downloadResult = await invoke(downloadHarness.adapter);
      expectFailure(downloadResult, 'invalid_result', `download ${name}`);
      assertSafe(downloadResult.error);
    }

    const sleepHarness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING'))],
      sleep: () => { throw named('AbortError'); },
    });
    const sleepResult = await invoke(sleepHarness.adapter);
    expectFailure(sleepResult, 'provider_failed', 'sleep AbortError');
    assertSafe(sleepResult.error);
  });
});

// --- Untrusted external failures -----------------------------------------

describe('filetrans analysis: foreign failure shapes are never trusted', () => {
  test('a submission rejection or body error shaped like AnalysisFailure stays submission_failed', async () => {
    const controlHarness = makeHarness({ plan: [() => { throw new Error('internal socket timed out'); }] });
    const controlError = expectFailure(await invoke(controlHarness.adapter), 'submission_failed', 'control rejection');

    const rejected = makeHarness({ plan: [() => { throw hostileFailure(); }] });
    const rejectedError = expectFailure(await invoke(rejected.adapter), 'submission_failed', 'hostile rejection');
    assert.equal(rejectedError.message, controlError.message, 'the message must stay the adapter static text');

    const erroredBody = makeHarness({
      plan: [
        () =>
          new Response(
            new ReadableStream({ start(controller) { controller.error(hostileFailure()); } }),
            { status: 200 },
          ),
      ],
    });
    const bodyError = expectFailure(await invoke(erroredBody.adapter), 'submission_failed', 'hostile body error');
    assert.equal(bodyError.message, controlError.message, 'the message must stay the adapter static text');

    for (const error of [rejectedError, bodyError]) {
      assertSafe(error);
      assert.equal(error.retryable, false);
    }
    assert.equal(rejected.fetchImpl.calls.length, 1);
    assert.equal(erroredBody.fetchImpl.calls.length, 1);
  });

  test('a polling rejection, sleep rejection or poll body error shaped like AnalysisFailure stays provider_failed', async () => {
    const controlHarness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => { throw new Error('internal socket timed out'); }],
    });
    const controlError = expectFailure(await invoke(controlHarness.adapter), 'provider_failed', 'control poll rejection');

    const rejected = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING')), () => { throw hostileFailure(); }],
    });
    const rejectedError = expectFailure(await invoke(rejected.adapter), 'provider_failed', 'hostile poll rejection');
    assert.equal(rejectedError.message, controlError.message, 'the message must stay the adapter static text');

    const sleepHarness = makeHarness({
      plan: [() => jsonResponse(submitPayload('PENDING'))],
      sleep: () => { throw hostileFailure(); },
    });
    const sleepError = expectFailure(await invoke(sleepHarness.adapter), 'provider_failed', 'hostile sleep rejection');
    assert.equal(sleepError.message, controlError.message, 'the message must stay the adapter static text');

    const erroredBody = makeHarness({
      plan: [
        () => jsonResponse(submitPayload('PENDING')),
        () =>
          new Response(
            new ReadableStream({ start(controller) { controller.error(hostileFailure()); } }),
            { status: 200 },
          ),
      ],
    });
    const bodyError = expectFailure(await invoke(erroredBody.adapter), 'provider_failed', 'hostile poll body error');
    assert.equal(bodyError.message, controlError.message, 'the message must stay the adapter static text');

    for (const error of [rejectedError, sleepError, bodyError]) {
      assertSafe(error);
      assert.equal(error.retryable, false);
    }
  });

  test('a download rejection or result body error shaped like AnalysisFailure stays invalid_result', async () => {
    const controlHarness = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => { throw new Error('internal socket timed out'); }],
    });
    const controlError = expectFailure(await invoke(controlHarness.adapter), 'invalid_result', 'control download rejection');

    const rejected = makeHarness({
      plan: [() => jsonResponse(resultSuccess()), () => { throw hostileFailure(); }],
    });
    const rejectedError = expectFailure(await invoke(rejected.adapter), 'invalid_result', 'hostile download rejection');
    assert.equal(rejectedError.message, controlError.message, 'the message must stay the adapter static text');

    const erroredBody = makeHarness({
      plan: [
        () => jsonResponse(resultSuccess()),
        () =>
          new Response(
            new ReadableStream({ start(controller) { controller.error(hostileFailure()); } }),
            { status: 200 },
          ),
      ],
    });
    const bodyError = expectFailure(await invoke(erroredBody.adapter), 'invalid_result', 'hostile result body error');
    assert.equal(bodyError.message, controlError.message, 'the message must stay the adapter static text');

    for (const error of [rejectedError, bodyError]) {
      assertSafe(error);
      assert.equal(error.retryable, false);
    }
  });

  test('genuine internal cancellation and deadline failures keep their own codes', { timeout: 2000 }, async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledHarness = makeHarness({ plan: [() => jsonResponse(submitPayload('PENDING'))] });
    const cancelledError = expectFailure(
      await invoke(cancelledHarness.adapter, { signal: controller.signal }),
      'cancelled',
      'internal cancellation',
    );
    assert.equal(Object.keys(cancelledError).sort().join(','), FAILURE_KEYS.join(','), 'internal failures keep the public shape');

    const timedOutHarness = makeHarness({ timeoutMs: 25, plan: [() => new Promise(() => {})] });
    const timedOutError = expectFailure(await invoke(timedOutHarness.adapter), 'timed_out', 'internal deadline');
    assert.notEqual(timedOutError.message, cancelledError.message, 'internal codes keep distinct static messages');
  });
});

// --- Configuration --------------------------------------------------------

describe('filetrans analysis: construction and configuration', () => {
  test('invalid configuration throws one static Error that never echoes option values', () => {
    const base = { apiKey: KEY, timeoutMs: 1000, pollIntervalMs: 250, maxPolls: 8, maxResultBytes: 4096 };
    const leaky = 'test-api-key-DO-NOT-LEAK';
    const cases = [
      ['apiKey empty', { ...base, apiKey: '' }],
      ['apiKey control', { ...base, apiKey: `test${String.fromCharCode(1)}key` }],
      ['apiKey newline', { ...base, apiKey: 'test\nkey' }],
      ['apiKey non-string', { ...base, apiKey: 42 }],
      ['timeoutMs zero', { ...base, timeoutMs: 0 }],
      ['timeoutMs negative', { ...base, timeoutMs: -5 }],
      ['timeoutMs fractional', { ...base, timeoutMs: 1.5 }],
      ['timeoutMs string', { ...base, timeoutMs: '1000' }],
      ['timeoutMs NaN', { ...base, timeoutMs: Number.NaN }],
      ['timeoutMs above the timer range', { ...base, timeoutMs: 2147483648 }],
      ['pollIntervalMs zero', { ...base, pollIntervalMs: 0 }],
      ['pollIntervalMs above the timer range', { ...base, pollIntervalMs: 2147483648 }],
      ['maxPolls zero', { ...base, maxPolls: 0 }],
      ['maxPolls above the cap', { ...base, maxPolls: 10001 }],
      ['maxPolls fractional', { ...base, maxPolls: 2.5 }],
      ['maxResultBytes zero', { ...base, maxResultBytes: 0 }],
      ['maxResultBytes above 16MiB', { ...base, maxResultBytes: 16 * 1024 * 1024 + 1 }],
      ['maxResultBytes fractional', { ...base, maxResultBytes: 10.5 }],
      ['fetch not a function', { ...base, fetch: 5 }],
      ['now not a function', { ...base, now: 'now' }],
      ['sleep not a function', { ...base, sleep: {} }],
      ['options null', null],
      ['options array', []],
    ];
    const messages = [];
    for (const [label, options] of cases) {
      assert.throws(() => new AlibabaFiletransAnalysis(options), (error) => {
        assert.ok(error instanceof Error, `${label}: must be an Error`);
        assert.equal(typeof error.message, 'string', `${label}: message type`);
        assert.ok(error.message.length > 0, `${label}: nonempty message`);
        messages.push(error.message);
        return true;
      }, label);
    }
    assert.ok(messages.every((message) => message === messages[0]), 'configuration errors must use one static message');
    assert.throws(() => new AlibabaFiletransAnalysis({ ...base, apiKey: leaky, maxPolls: 0 }), (error) => {
      assert.ok(!String(error.message).includes(leaky), 'the message must not contain the rejected key');
      assert.ok(!String(error.stack).includes(leaky), 'the stack must not contain the rejected key');
      return true;
    }, 'leaky key');
  });

  test('boundary-valid configuration constructs without any request or timer side effect', () => {
    let calls = 0;
    const fetchSpy = () => {
      calls += 1;
      throw new Error('construction must not perform requests');
    };
    assert.doesNotThrow(() => {
      const adapter = new AlibabaFiletransAnalysis({
        apiKey: KEY,
        timeoutMs: 2147483647,
        pollIntervalMs: 2147483647,
        maxPolls: 10000,
        maxResultBytes: 16 * 1024 * 1024,
        fetch: fetchSpy,
        now: () => T0,
        sleep: () => Promise.resolve(),
      });
      assert.ok(adapter instanceof AlibabaFiletransAnalysis);
    }, 'boundary values must be accepted');
    assert.doesNotThrow(() => new AlibabaFiletransAnalysis({
      apiKey: KEY,
      timeoutMs: 1,
      pollIntervalMs: 1,
      maxPolls: 1,
      maxResultBytes: 1,
    }), 'minimal positive configuration and native defaults must be accepted');
    assert.equal(calls, 0, 'no request at construction');
  });

  test('the API key is held in a private field and never exposed', () => {
    const adapter = new AlibabaFiletransAnalysis({
      apiKey: KEY,
      timeoutMs: 1000,
      pollIntervalMs: 250,
      maxPolls: 4,
      maxResultBytes: 1024,
    });
    assert.deepEqual(Object.keys(adapter), [], 'no enumerable own state');
    assert.equal(adapter.apiKey, undefined, 'the key is not a public property');
    assert.ok(!JSON.stringify(adapter).includes(KEY), 'the serialized adapter must not contain the key');
  });
});
