// M02/D21-D22 independent acceptance tests for the free-gated, stateless
// Gemini inline audio analysis adapter (a LocalAudioAnalysisPort implementation).
//
// Synthetic only: the clip is three structural octets, never human or
// machine speech; there is no outbound network, credential, filesystem or live
// provider call. Every request goes through an injected fake fetch and every
// clip read through an injected fake reader, so each case is deterministic.
// Failures are reduced through the public toRoundFailure(error, 'analysis')
// contract. These cases encode the acceptance requirements themselves, not the
// current source, so a defect surfaces as a failing test rather than a widened
// expectation. Passing this file proves structure only; it is never live or
// audio-quality acceptance.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_AUDIO_ENDPOINT,
  GeminiAudioAnalysis,
} from '../../apps/server/src/providers/google/gemini-audio-analysis.ts';
import {
  GEMINI_AUDIO_MODEL,
  GEMINI_AUDIO_SCHEMA,
  GEMINI_TIMING_SOURCE,
} from '../../apps/server/src/providers/google/gemini-audio-result.ts';
import { makeRoundError, toRoundFailure } from '../../apps/server/src/application/round-errors.ts';

const KEY = 'synthetic-test-key-not-a-secret';
const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const AUDIO_BYTES = new Uint8Array([1, 2, 3]);
const AUDIO_BASE64 = 'AQID';
const PROVIDER_FAILED_MESSAGE = 'The round failed while being processed.';
const FORBIDDEN_REQUEST_KEYS = ['tools', 'agent', 'previous_interaction', 'history', 'background', 'stream'];

// --- Fixtures -------------------------------------------------------------

const asset = (over = {}) => ({
  asset_id: ASSET_ID,
  media_type: 'audio/wav',
  duration_ms: 1000,
  sample_rate_hz: 16000,
  channels: 1,
  ...over,
});

const stored = (over = {}) => ({ asset: asset(), storage_key: ASSET_ID, ...over });

const validPayload = () => ({
  transcript: '本地测试。',
  segments: [
    {
      text: '本地测试。',
      units: [
        { text: '本地', granularity: 'word', start_ms: 0, end_ms: 400 },
        { text: '测试', granularity: 'word', start_ms: 400, end_ms: 900 },
      ],
      emotion: '平静',
    },
  ],
});

const envelope = (payload, over = {}) => ({
  model: GEMINI_AUDIO_MODEL,
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
  ...over,
});

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const audioBlob = () => new Blob([AUDIO_BYTES], { type: 'audio/wav' });

// --- Harness --------------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const drain = async () => {
  await tick();
  await tick();
};

function makeAdapter(config = {}) {
  const calls = [];
  const reads = [];
  const plan = config.plan ?? [];
  const fetchImpl = (url, init) => {
    const index = calls.length;
    calls.push({ url: String(url), init });
    const step = plan[Math.min(index, plan.length - 1)];
    if (typeof step !== 'function') throw new Error('harness: plan step must be a function');
    return Promise.resolve(step(index));
  };
  const withinRead = (storageKey, options) => {
    reads.push({ storageKey, options });
    const read = config.readAudio ?? (() => Promise.resolve(audioBlob()));
    return read(storageKey, options);
  };
  const adapter = new GeminiAudioAnalysis({
    apiKey: config.apiKey ?? KEY,
    freeTierConfirmed: config.freeTierConfirmed ?? true,
    timeoutMs: config.timeoutMs,
    readAudio: withinRead,
    fetch: fetchImpl,
  });
  return { adapter, calls, reads };
}

async function invoke(adapter, options = {}) {
  const { audio = stored(), signal } = options;
  const controller = signal === undefined ? new AbortController() : null;
  try {
    const value = await adapter.analyze(audio, { signal: signal ?? controller.signal });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function expectFailure(result, code, note = 'case') {
  assert.equal(result.ok, false, `${note}: expected ${code} but the round succeeded`);
  const failure = toRoundFailure(result.error, 'analysis');
  assert.equal(failure.code, code, `${note}: failure code`);
  assert.equal(failure.stage, 'analysis', `${note}: stage`);
  assert.ok(typeof failure.message === 'string' && failure.message.length > 0, `${note}: safe message`);
  return failure;
}

// --- Stateless inline request ---------------------------------------------

describe('gemini audio analysis: stateless inline request', () => {
  test('sends exactly one stateless inline POST and never echoes transcript or key hints', async () => {
    const harness = makeAdapter({ plan: [() => jsonResponse(envelope(validPayload()))] });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);

    assert.equal(harness.calls.length, 1, 'exactly one request');
    const [call] = harness.calls;
    assert.equal(GEMINI_AUDIO_ENDPOINT, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(call.url, GEMINI_AUDIO_ENDPOINT, 'official interactions endpoint');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.ok(call.init.signal instanceof AbortSignal, 'the request carries an AbortSignal');
    assert.deepEqual(Object.keys(call.init.headers).sort(), ['Content-Type', 'x-goog-api-key']);
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.equal(call.init.headers['x-goog-api-key'], KEY, 'key header');

    const body = JSON.parse(call.init.body);
    assert.deepEqual(
      Object.keys(body).sort(),
      ['generation_config', 'input', 'model', 'response_format', 'service_tier', 'store'],
    );
    assert.equal(body.model, GEMINI_AUDIO_MODEL);
    assert.equal(body.model, 'gemini-3.8-flash');
    assert.equal(body.store, false);
    assert.equal(body.service_tier, 'standard');
    assert.deepEqual(body.generation_config, { thinking_level: 'low', max_output_tokens: 4096 });
    assert.deepEqual(body.response_format, {
      type: 'text',
      mime_type: 'application/json',
      schema: GEMINI_AUDIO_SCHEMA,
    });

    assert.ok(Array.isArray(body.input) && body.input.length === 2, 'text plus one inline audio part');
    assert.equal(body.input[0].type, 'text');
    assert.equal(typeof body.input[0].text, 'string');
    assert.equal(body.input[1].type, 'audio');
    assert.equal(body.input[1].mime_type, 'audio/wav');
    assert.equal(body.input[1].data, AUDIO_BASE64);
    assert.deepEqual([...Buffer.from(body.input[1].data, 'base64')], [1, 2, 3], 'inline bytes round-trip');

    const serialized = call.init.body;
    for (const forbidden of FORBIDDEN_REQUEST_KEYS) {
      assert.ok(!serialized.includes(forbidden), `request must not carry "${forbidden}"`);
    }
    for (const hint of [ASSET_ID, '本地', KEY]) {
      assert.ok(!serialized.includes(hint), `prompt must not hint the transcript, asset or key: ${hint}`);
    }
  });
});

// --- Free-gate and caller signal gating -----------------------------------

describe('gemini audio analysis: free-gate and caller signal gating', () => {
  test('an unconfirmed free tier is provider_unavailable before any read or fetch', async () => {
    const harness = makeAdapter({
      plan: [() => jsonResponse(envelope(validPayload()))],
      freeTierConfirmed: false,
    });
    expectFailure(await invoke(harness.adapter), 'provider_unavailable');
    assert.equal(harness.reads.length, 0, 'audio must not be read');
    assert.equal(harness.calls.length, 0, 'no request may be sent');
  });

  test('a pre-aborted caller is cancelled without any read or fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeAdapter({ plan: [() => jsonResponse(envelope(validPayload()))] });
    expectFailure(await invoke(harness.adapter, { signal: controller.signal }), 'cancelled');
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.calls.length, 0);
  });

  test('a pre-aborted caller carrying a trusted timeout reason preserves timed_out', async () => {
    const controller = new AbortController();
    controller.abort(makeRoundError('timed_out', 'analysis'));
    const harness = makeAdapter({ plan: [() => jsonResponse(envelope(validPayload()))] });
    const failure = expectFailure(await invoke(harness.adapter, { signal: controller.signal }), 'timed_out');
    const cancelledMessage = toRoundFailure(makeRoundError('cancelled', 'analysis'), 'analysis').message;
    assert.notEqual(failure.message, cancelledMessage, 'timeout keeps its own static code');
    assert.equal(harness.reads.length, 0);
    assert.equal(harness.calls.length, 0);
  });
});

// --- Annotation mapping ---------------------------------------------------

describe('gemini audio analysis: annotation mapping', () => {
  test('maps a completed envelope to a validated model-estimate annotation without payload leakage', async () => {
    const harness = makeAdapter({ plan: [() => jsonResponse(envelope(validPayload()))] });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    const doc = result.value;

    assert.equal(doc.schema_version, '0.1');
    assert.equal(doc.asset_id, ASSET_ID);
    assert.equal(doc.transcript, '本地测试。');
    assert.equal(doc.segments.length, 1);

    const segment = doc.segments[0];
    assert.equal(segment.text, '本地测试。');
    assert.deepEqual(segment.timing, {
      status: 'available',
      start_ms: 0,
      end_ms: 900,
      source: `${GEMINI_TIMING_SOURCE}/derived-segment-envelope`,
    });
    assert.deepEqual(
      segment.units.map((unit) => [
        unit.text,
        unit.granularity,
        unit.timing.start_ms,
        unit.timing.end_ms,
        unit.timing.source,
      ]),
      [
        ['本地', 'word', 0, 400, GEMINI_TIMING_SOURCE],
        ['测试', 'word', 400, 900, GEMINI_TIMING_SOURCE],
      ],
    );
    assert.ok(segment.units.every((unit) => unit.timing.source.includes('model-estimate-not-forced-alignment')));
    assert.ok(segment.units.every((unit) => unit.timing.status === 'available' && unit.timing.end_ms > unit.timing.start_ms));

    assert.equal(doc.observations.length, 1);
    const observation = doc.observations[0];
    assert.equal(observation.kind, 'emotion');
    assert.equal(observation.label, '平静');
    assert.equal(observation.timing.status, 'available');
    assert.equal(observation.source_provider, 'google');
    assert.equal(observation.source_model, GEMINI_AUDIO_MODEL);
    assert.deepEqual(observation.segment_ids, [segment.segment_id]);
    assert.equal(Object.prototype.hasOwnProperty.call(observation, 'score'), false, 'no invented emotion score');

    assert.equal(doc.capabilities.word_timing.status, 'ok');
    assert.deepEqual(doc.capabilities.word_timing, {
      status: 'ok',
      source_provider: 'google',
      source_model: GEMINI_AUDIO_MODEL,
    });
    assert.equal(doc.capabilities.emotion.status, 'ok');
    assert.equal(doc.capabilities.prosody.status, 'unavailable');
    assert.equal(doc.capabilities.sound_event.status, 'unavailable');

    const serialized = JSON.stringify(doc);
    assert.ok(!serialized.includes(KEY));
    assert.ok(!serialized.includes('storage_key'));
    assert.ok(!serialized.includes('provider_payload'));
  });
});

// --- Malformed envelopes --------------------------------------------------

describe('gemini audio analysis: malformed envelopes are invalid_result', () => {
  test('wrong model, incomplete status, missing steps or a non-text step are invalid_result', async () => {
    const missingSteps = envelope(validPayload());
    delete missingSteps.steps;
    const cases = [
      ['wrong model', envelope(validPayload(), { model: 'gemini-3.5-flash' })],
      ['incomplete status', envelope(validPayload(), { status: 'incomplete' })],
      ['missing steps', missingSteps],
      [
        'tool step',
        envelope(validPayload(), {
          steps: [{ type: 'tool_call', content: [{ type: 'text', text: JSON.stringify(validPayload()) }] }],
        }),
      ],
      [
        'non-text content block',
        envelope(validPayload(), {
          steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'x' }] }],
        }),
      ],
    ];
    for (const [label, body] of cases) {
      const harness = makeAdapter({ plan: [() => jsonResponse(body)] });
      const failure = expectFailure(await invoke(harness.adapter), 'invalid_result', label);
      assert.equal(harness.calls.length, 1, `${label}: one request`);
      assert.ok(!failure.message.includes(ASSET_ID), `${label}: no asset hint in the message`);
    }
  });
});

// --- Honest timing and coverage -------------------------------------------

describe('gemini audio analysis: timing and coverage must be honest', () => {
  test('zero, missing or dropped unit bounds and transcript mismatch are invalid_result', async () => {
    const zeroBounds = {
      transcript: '本地测试。',
      segments: [
        {
          text: '本地测试。',
          units: [
            { text: '本地', granularity: 'word', start_ms: 0, end_ms: 0 },
            { text: '测试', granularity: 'word', start_ms: 0, end_ms: 900 },
          ],
          emotion: null,
        },
      ],
    };
    const missingBounds = {
      transcript: '本地测试。',
      segments: [
        {
          text: '本地测试。',
          units: [
            { text: '本地', granularity: 'word', start_ms: null, end_ms: null },
            { text: '测试', granularity: 'word', start_ms: 400, end_ms: 900 },
          ],
          emotion: null,
        },
      ],
    };
    const droppedWord = {
      transcript: '本地测试。',
      segments: [
        {
          text: '本地测试。',
          units: [{ text: '测试', granularity: 'word', start_ms: 400, end_ms: 900 }],
          emotion: null,
        },
      ],
    };
    const transcriptMismatch = {
      transcript: '完全不同。',
      segments: [
        {
          text: '本地测试。',
          units: [
            { text: '本地', granularity: 'word', start_ms: 0, end_ms: 400 },
            { text: '测试', granularity: 'word', start_ms: 400, end_ms: 900 },
          ],
          emotion: null,
        },
      ],
    };

    const cases = [
      ['zero bounds', zeroBounds],
      ['missing bounds', missingBounds],
      ['dropped word coverage', droppedWord],
      ['transcript mismatch', transcriptMismatch],
    ];
    for (const [label, payload] of cases) {
      const harness = makeAdapter({ plan: [() => jsonResponse(envelope(payload))] });
      const result = await invoke(harness.adapter);
      expectFailure(result, 'invalid_result', label);
      assert.equal(result.ok, false, `${label}: never a partial success`);
    }
  });
});

// --- Block assembly -------------------------------------------------------

describe('gemini audio analysis: block assembly', () => {
  test('multiple text blocks join in order and thought content is never returned', async () => {
    const payloadString = JSON.stringify(validPayload());
    const cut = Math.floor(payloadString.length / 2);
    const body = {
      model: GEMINI_AUDIO_MODEL,
      status: 'completed',
      steps: [
        { type: 'thought', content: [{ type: 'text', text: 'IGNORED-THOUGHT-TEXT' }] },
        {
          type: 'model_output',
          content: [
            { type: 'text', text: payloadString.slice(0, cut) },
            { type: 'thought', text: 'IGNORED-BLOCK-THOUGHT' },
          ],
        },
        { type: 'model_output', content: [{ type: 'text', text: payloadString.slice(cut) }] },
      ],
    };
    const harness = makeAdapter({ plan: [() => jsonResponse(body)] });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.transcript, '本地测试。');
    const serialized = JSON.stringify(result.value);
    assert.ok(!serialized.includes('IGNORED-THOUGHT-TEXT'));
    assert.ok(!serialized.includes('IGNORED-BLOCK-THOUGHT'));
  });
});

// --- Transport and size failures ------------------------------------------

describe('gemini audio analysis: transport failure surfaces', () => {
  test('an HTTP 429 fails once with a safe provider_failed message and no reflected body', async () => {
    const privateBody = '<html>PRIVATE network html body secret token</html>';
    const harness = makeAdapter({
      plan: [() => new Response(privateBody, { status: 429, headers: { 'content-type': 'text/html' } })],
    });
    const result = await invoke(harness.adapter);
    const failure = expectFailure(result, 'provider_failed', '429');
    assert.equal(harness.calls.length, 1, 'exactly one call, no retry');
    assert.equal(failure.message, PROVIDER_FAILED_MESSAGE);
    assert.ok(!JSON.stringify(failure).includes('PRIVATE'));
    assert.ok(!String(result.error.stack ?? '').includes('PRIVATE'));
  });

  test('an advertised or actual response body above the cap fails as provider_failed', async () => {
    const advertised = {
      ok: true,
      headers: {
        get: (name) =>
          name.toLowerCase() === 'content-type'
            ? 'application/json'
            : name.toLowerCase() === 'content-length'
              ? '2000000'
              : null,
      },
      body: new ReadableStream({ pull() {}, cancel() {} }, { highWaterMark: 0 }),
    };
    const advertisedHarness = makeAdapter({ plan: [() => advertised] });
    expectFailure(await invoke(advertisedHarness.adapter), 'provider_failed', 'advertised length');
    assert.equal(advertisedHarness.calls.length, 1);

    const oversized = 'a'.repeat(1048576 + 1);
    const oversizedHarness = makeAdapter({
      plan: [() => new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } })],
    });
    expectFailure(await invoke(oversizedHarness.adapter), 'provider_failed', 'oversized body');
    assert.equal(oversizedHarness.calls.length, 1);
  });
});

// --- Input validation -----------------------------------------------------

describe('gemini audio analysis: input validation before any request', () => {
  test('oversized clip, mismatched native Blob MIME, duck-typed blob or bad asset type are invalid_input', async () => {
    const oversized = new Uint8Array(10485760 + 1);
    const cases = [
      ['oversized clip', () => Promise.resolve(new Blob([oversized], { type: 'audio/wav' })), {}],
      ['mismatched native MIME', () => Promise.resolve(new Blob([AUDIO_BYTES], { type: 'audio/mpeg' })), {}],
      ['duck-typed blob', () => Promise.resolve({ size: 3, type: 'audio/wav', arrayBuffer: async () => AUDIO_BYTES.buffer }), {}],
      ['unsupported asset media type', () => Promise.resolve(audioBlob()), { asset: asset({ media_type: 'audio/xyz' }) }],
    ];
    for (const [label, readAudio, over] of cases) {
      const harness = makeAdapter({ plan: [() => jsonResponse(envelope(validPayload()))], readAudio });
      expectFailure(await invoke(harness.adapter, { audio: stored(over) }), 'invalid_input', label);
      assert.equal(harness.calls.length, 0, `${label}: no request may be sent`);
    }
  });
});

// --- Bounded deadlines ----------------------------------------------------

describe('gemini audio analysis: bounded deadlines', () => {
  test('a read that never settles times out', { timeout: 2000 }, async () => {
    const harness = makeAdapter({
      plan: [() => jsonResponse(envelope(validPayload()))],
      timeoutMs: 60,
      readAudio: () => new Promise(() => {}),
    });
    expectFailure(await invoke(harness.adapter), 'timed_out', 'read');
    assert.equal(harness.calls.length, 0);
  });

  test('a fetch that never settles times out', { timeout: 2000 }, async () => {
    const harness = makeAdapter({ plan: [() => new Promise(() => {})], timeoutMs: 60 });
    expectFailure(await invoke(harness.adapter), 'timed_out', 'fetch');
    assert.equal(harness.calls.length, 1);
  });

  test('a response body that never completes times out', { timeout: 2000 }, async () => {
    const never = new ReadableStream({ pull() {} }, { highWaterMark: 0 });
    const harness = makeAdapter({
      plan: [() => new Response(never, { status: 200, headers: { 'content-type': 'application/json' } })],
      timeoutMs: 60,
    });
    expectFailure(await invoke(harness.adapter), 'timed_out', 'body');
    assert.equal(harness.calls.length, 1);
  });

  test('a fetch response arriving after the deadline has its body cancelled', { timeout: 2000 }, async () => {
    let settle;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const harness = makeAdapter({ plan: [() => pending], timeoutMs: 60 });
    expectFailure(await invoke(harness.adapter), 'timed_out', 'late fetch');
    assert.equal(harness.calls.length, 1);
    settle(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    await drain();
    assert.equal(cancelled, true, 'the late response body is cancelled after the deadline');
  });
});

// --- Caller isolation -----------------------------------------------------

describe('gemini audio analysis: caller isolation', () => {
  test('the validated asset snapshot survives caller mutation during the await', async () => {
    const original = stored();
    const harness = makeAdapter({
      plan: [() => jsonResponse(envelope(validPayload()))],
      readAudio: () => {
        original.asset.duration_ms = -1;
        original.asset.asset_id = '';
        delete original.asset.media_type;
        return Promise.resolve(audioBlob());
      },
    });
    const result = await invoke(harness.adapter, { audio: original });
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.asset_id, ASSET_ID, 'the snapshot, not the mutated caller object, is used');
  });
});

// --- Stream cleanup -------------------------------------------------------

describe('gemini audio analysis: stream cleanup', () => {
  test('the response reader lock is released after a successful read', async () => {
    let stream;
    const harness = makeAdapter({
      plan: [
        () => {
          stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(envelope(validPayload()))));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
        },
      ],
    });
    const result = await invoke(harness.adapter);
    assert.equal(result.ok, true, `expected success: ${JSON.stringify(result.error)}`);
    await drain();
    assert.equal(stream.locked, false, 'the reader lock must be released');
  });

  test('the response reader lock is released after a body error', async () => {
    let stream;
    const harness = makeAdapter({
      plan: [
        () => {
          stream = new ReadableStream({ pull(controller) { controller.error(new Error('stream boom')); } });
          return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
        },
      ],
    });
    const result = await invoke(harness.adapter);
    expectFailure(result, 'provider_failed', 'errored body');
    await drain();
    assert.equal(stream.locked, false, 'the reader lock must be released after failure');
  });
});
