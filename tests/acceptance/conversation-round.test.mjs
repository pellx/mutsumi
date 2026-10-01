// M03 permanent conversation/orchestration acceptance regression suite.
// Synthetic structural fixtures only: no real recordings, no synthesized human
// speech, no network, no live provider quality claim. These modules run under
// Node 25 built-in type stripping via direct .ts imports. This file is the only
// artifact created by this task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundService } from '../../apps/server/src/application/round-service.ts';
import { makeRoundError } from '../../apps/server/src/application/round-errors.ts';
import { buildDialogueContext } from '../../apps/server/src/application/dialogue-context.ts';
import { buildReplyPlan } from '../../apps/server/src/application/expression-plan.ts';

const SRC = '11111111-1111-4111-8111-111111111111';
const INP = '22222222-2222-4222-8222-222222222222';
const OUT = '33333333-3333-4333-8333-333333333333';
const SESSION = 'owner-development-mock';

const WAV = (id) => ({ asset_id: id, media_type: 'audio/wav', duration_ms: 1000, sample_rate_hz: 16000, channels: 1 });

const mkAnnotation = () => ({
  schema_version: '0.1',
  asset_id: INP,
  transcript: 'hello world',
  segments: [{
    segment_id: 'seg-1',
    text: 'hello world',
    timing: { status: 'available', start_ms: 0, end_ms: 1000, source: 'fixture' },
    units: [
      { text: 'hello', granularity: 'word', timing: { status: 'available', start_ms: 0, end_ms: 500, source: 'fixture' } },
      { text: 'world', granularity: 'word', timing: { status: 'available', start_ms: 500, end_ms: 1000, source: 'fixture' } },
    ],
  }],
  observations: [],
  capabilities: {
    word_timing: { status: 'ok', source_provider: 'fixture', source_model: 'fixture-1' },
    emotion: { status: 'unavailable', reason: 'fixture carries no emotion' },
    prosody: { status: 'unavailable', reason: 'fixture carries no prosody' },
    sound_event: { status: 'unavailable', reason: 'fixture carries no sound events' },
  },
});

const mkDraft = () => ({
  reply_text: 'Hi there',
  segments: [{ text: 'Hi there', tone: 'warm', emotion_intensity: 0.5, pace: null, pause_after_ms: 250 }],
});

const mkSpeech = () => ({
  asset: WAV(OUT),
  storage_key: OUT,
  alignment: null,
  applied_controls: [],
  unsupported_controls: [],
});

const mkPersona = () => ({ persona_id: 'p1', name: 'Mutsumi', instructions: ['speak warmly'] });

const mkHistory = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ turn_id: OUT, user_text: 'u' + i, assistant_text: 'a' + i, assistant_playback_completed: false });
  return out;
};

const bytes = (arr) => Uint8Array.from(arr);
const hex = (v, len) => v.toString(16).padStart(len, '0');
const reqId = (n) => `${hex(n, 8)}-0000-4000-8000-${hex(n * 7 + 1, 12).slice(0, 12)}`;
const sub = (bytesArr, id) => ({ session_id: SESSION, client_request_id: reqId(id), submission: { bytes: bytesArr, declared_media_type: 'audio/wav' } });

function harness(opts = {}) {
  const calls = { intake: 0, analysis: 0, dialogue: 0, synth: 0, save: 0, getTurn: 0, mark: 0 };
  const received = [];
  let saved = null;
  const deps = {
    mode: 'development-mock',
    deadlineMs: opts.deadlineMs ?? 120000,
    intake: {
      async ingest(s) {
        calls.intake++;
        received.push(Array.from(s.submission ? [] : []));
        if (opts.intakeGate) await opts.intakeGate;
        return { original: { asset: structuredClone(WAV(SRC)), storage_key: SRC }, analysis: { asset: structuredClone(WAV(INP)), storage_key: INP } };
      },
    },
    analysis: { async analyze() { calls.analysis++; return opts.analysis ? opts.analysis() : structuredClone(mkAnnotation()); } },
    dialogue: { async generate() { calls.dialogue++; if (opts.dialogueFail) throw opts.dialogueFail; return structuredClone(mkDraft()); } },
    synthesis: { async synthesize() { calls.synth++; if (opts.synthesisFail) throw opts.synthesisFail; return structuredClone(mkSpeech()); } },
    store: {
      loadPersona: async () => structuredClone(mkPersona()),
      loadPreferences: async () => [],
      recentHistory: async () => structuredClone(opts.history ?? []),
      saveTurn: async (t) => { calls.save++; if (opts.saveFail) throw new Error('disk'); saved = structuredClone(t); },
      getTurn: async () => { calls.getTurn++; return saved ? structuredClone(saved) : null; },
      markPlaybackCompleted: async () => { calls.mark++; if (!saved) throw new Error('no turn'); const c = structuredClone(saved); c.playback_completed = true; saved = c; return structuredClone(saved); },
    },
  };
  return { service: new RoundService(deps), calls, saved: () => saved };
}

async function terminal(service, jobId, budgetMs = 2000) {
  const t0 = Date.now();
  for (;;) {
    const j = service.getJob(jobId);
    if (j && (j.status === 'complete' || j.status === 'failed')) return j;
    if (Date.now() - t0 >= budgetMs) throw new Error('job did not reach a terminal state within budget');
    await new Promise((r) => setTimeout(r, 4));
  }
}

test('complete round sequences each port once and stores a valid unplayed record', async () => {
  const { service, calls } = harness();
  const job = service.submit(sub(bytes([1, 2, 3, 4]), 1));
  const done = await terminal(service, job.job_id);
  assert.equal(done.status, 'complete');
  assert.equal(done.persisted, true);
  assert.equal(calls.intake, 1);
  assert.equal(calls.analysis, 1);
  assert.equal(calls.dialogue, 1);
  assert.equal(calls.synth, 1);
  assert.equal(calls.save, 1);
  const rec = done.record;
  assert.ok(rec && typeof rec === 'object');
  assert.equal(rec.playback_completed, false);
  assert.equal(rec.turn_id, done.turn_id);
  assert.equal(rec.source_asset.asset_id, SRC);
  assert.equal(rec.input_asset.asset_id, INP);
  assert.notEqual(rec.source_asset.asset_id, rec.input_asset.asset_id);
  assert.ok(rec.output_asset && rec.output_asset.asset_id === OUT);
  assert.ok(rec.reply_plan && rec.reply_plan.segments.length === 1);
  assert.equal(rec.output_alignment, null);
  assert.deepEqual(rec.applied_controls, []);
  assert.deepEqual(rec.unsupported_controls, []);
  for (const stage of ['intake', 'analysis', 'context', 'dialogue', 'expression', 'synthesis', 'storage', 'complete']) {
    assert.equal(rec.stages[stage].status, 'ok', stage);
  }
});

test('idempotent same client id with identical bytes returns same job while busy and calls intake once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { service, calls } = harness({ intakeGate: gate });
  try {
    const first = service.submit(sub(bytes([1, 1, 1]), 2));
    const dup = service.submit(sub(bytes([1, 1, 1]), 2));
    assert.equal(dup.job_id, first.job_id);
    assert.equal(dup.status, 'processing');
    release();
    const done = await terminal(service, first.job_id);
    assert.equal(done.status, 'complete');
    assert.equal(calls.intake, 1);
    assert.equal(calls.dialogue, 1);
  } finally { release(); }
});

test('same client id with changed bytes is invalid_input', () => {
  const { service } = harness();
  service.submit(sub(bytes([1, 2, 3]), 3));
  assert.throws(
    () => service.submit(sub(bytes([9, 9, 9]), 3)),
    (e) => /input was not valid/.test(e.message),
  );
});

test('new request id while a round is pending is rejected busy, then the pending round completes', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { service } = harness({ intakeGate: gate });
  try {
    const first = service.submit(sub(bytes([1]), 4));
    assert.equal(first.status, 'processing');
    assert.throws(() => service.submit(sub(bytes([2]), 5)), (e) => /busy/.test(e.message));
    release();
    const done = await terminal(service, first.job_id);
    assert.equal(done.status, 'complete');
  } finally { release(); }
});

test('caller mutation of submitted bytes and returned snapshots cannot alter accepted state', async () => {
  const { service } = harness();
  const buf = bytes([7, 8, 9]);
  const job = service.submit(sub(buf, 6));
  buf[0] = 99;
  job.status = 'tampered';
  job.record = { fabricated: true };
  assert.notEqual(service.getJob(job.job_id).status, 'tampered');
  assert.equal(service.getJob(job.job_id).record, null);
  const done = await terminal(service, job.job_id);
  const rec = done.record;
  assert.equal(rec.annotation.transcript, 'hello world');
  rec.playback_completed = true;
  rec.input_asset.asset_id = 'zzz';
  const reread = service.getJob(job.job_id).record;
  assert.equal(reread.playback_completed, false);
  assert.equal(reread.input_asset.asset_id, INP);
  assert.equal(done.status, 'complete');
});

test('unavailable analysis records both assets and an explicit gap and skips dialogue and synthesis', async () => {
  const { service, calls } = harness({ analysis: () => { throw makeRoundError('provider_unavailable', 'analysis'); } });
  const job = service.submit(sub(bytes([1]), 7));
  const done = await terminal(service, job.job_id);
  assert.equal(done.status, 'failed');
  assert.equal(done.failure.code, 'provider_unavailable');
  assert.equal(done.failure.stage, 'analysis');
  assert.equal(done.persisted, true);
  assert.equal(done.record.source_asset.asset_id, SRC);
  assert.equal(done.record.input_asset.asset_id, INP);
  assert.equal(done.record.annotation, null);
  assert.equal(done.record.stages.analysis.status, 'unavailable');
  assert.equal(done.record.stages.dialogue.status, 'skipped');
  assert.equal(done.record.stages.synthesis.status, 'skipped');
  assert.equal(calls.dialogue, 0);
  assert.equal(calls.synth, 0);
});

test('analysis with zero-duration word timing is invalid_result and never proceeds to dialogue', async () => {
  const { service, calls } = harness({ analysis: () => { const a = mkAnnotation(); a.segments[0].units[0].timing.start_ms = 500; a.segments[0].units[0].timing.end_ms = 500; return a; } });
  const job = service.submit(sub(bytes([1]), 8));
  const done = await terminal(service, job.job_id);
  assert.equal(done.status, 'failed');
  assert.equal(done.failure.code, 'invalid_result');
  assert.equal(done.failure.stage, 'analysis');
  assert.equal(done.record.annotation, null);
  assert.equal(done.record.reply_draft, null);
  assert.equal(calls.dialogue, 0);
});

test('a foreign failure reduces to a safe static message without leaking private provider text', async () => {
  const { service } = harness({ analysis: () => { throw new Error('PRIVATE secret at https://internal.example/signed?token=abc'); } });
  const job = service.submit(sub(bytes([1]), 9));
  const done = await terminal(service, job.job_id);
  assert.equal(done.failure.code, 'provider_failed');
  assert.doesNotMatch(done.failure.message, /PRIVATE|https|token|internal/);
  assert.equal(done.failure.message, 'The round failed while being processed.');
});

test('a non-cooperative analysis hits the deadline and a late completion cannot change the terminal job', async () => {
  const seen = [];
  const onUnhandled = (reason) => { seen.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  let resolveLate;
  try {
    const { service, calls } = harness({
      deadlineMs: 40,
      analysis: () => new Promise((r) => { resolveLate = r; }),
    });
    const job = service.submit(sub(bytes([1]), 10));
    const done = await terminal(service, job.job_id);
    assert.equal(done.status, 'failed');
    assert.equal(done.failure.code, 'timed_out');
    assert.equal(done.failure.stage, 'analysis');
    assert.equal(calls.dialogue, 0);
    resolveLate(structuredClone(mkAnnotation()));
    await new Promise((r) => setTimeout(r, 40));
    const after = service.getJob(job.job_id);
    assert.equal(after.status, 'failed');
    assert.equal(after.failure.code, 'timed_out');
    assert.deepEqual(seen, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a failed save keeps a valid public partial result, marks storage_failed, and does not retry', async () => {
  const { service, calls } = harness({ saveFail: true });
  const job = service.submit(sub(bytes([1]), 11));
  const done = await terminal(service, job.job_id);
  assert.equal(done.status, 'failed');
  assert.equal(done.failure.code, 'storage_failed');
  assert.equal(done.persisted, false);
  assert.equal(calls.save, 1);
  assert.ok(done.record);
  assert.ok(done.record.annotation);
  assert.ok(done.record.reply_plan);
  assert.equal(done.record.stages.storage.status, 'failed');
});

test('the public record exposes no storage key, raw payload, signed reference or filesystem path', async () => {
  const { service } = harness();
  const job = service.submit(sub(bytes([1, 2]), 12));
  const done = await terminal(service, job.job_id);
  const blob = JSON.stringify(done.record);
  for (const forbidden of ['storage_key', 'http', 'oss://', 'file:', 'D:\\', '/', 'PRIVATE']) {
    assert.ok(!blob.includes(forbidden), `public record must not contain ${forbidden}`);
  }
});

test('wrong-mode session, malformed request id and oversized input are rejected before any port runs', () => {
  const { service, calls } = harness();
  assert.throws(() => service.submit({ session_id: 'owner-live', client_request_id: reqId(13), submission: { bytes: bytes([1]), declared_media_type: 'audio/wav' } }), (e) => /input was not valid/.test(e.message));
  assert.throws(() => service.submit({ session_id: SESSION, client_request_id: 'not-a-uuid', submission: { bytes: bytes([1]), declared_media_type: 'audio/wav' } }), (e) => /input was not valid/.test(e.message));
  assert.throws(() => service.submit({ session_id: SESSION, client_request_id: reqId(14), submission: { bytes: new Uint8Array(10 * 1024 * 1024 + 1), declared_media_type: 'audio/wav' } }), (e) => /input was not valid/.test(e.message));
  assert.equal(calls.intake, 0);
  assert.equal(calls.analysis, 0);
});

test('playback stays false until an explicit completion is marked and marking is idempotent', async () => {
  const { service } = harness();
  const job = service.submit(sub(bytes([1]), 15));
  const done = await terminal(service, job.job_id);
  const turnId = done.turn_id;
  const before = await service.getTurn(SESSION, turnId);
  assert.equal(before.playback_completed, false);
  const marked = await service.markPlaybackCompleted(SESSION, turnId);
  assert.equal(marked.playback_completed, true);
  assert.ok(marked.output_asset);
  const again = await service.markPlaybackCompleted(SESSION, turnId);
  assert.equal(again.playback_completed, true);
});

test('dialogue context bounds history to six turns, flags truncation, and keeps persona, preferences and user speech separate', () => {
  const input = {
    asset: structuredClone(WAV(INP)),
    annotation: structuredClone(mkAnnotation()),
    persona: structuredClone(mkPersona()),
    preferences: [{ key: 'reply_length', value: 'short' }],
    history: mkHistory(8),
  };
  const snapshot = JSON.stringify(input);
  const ctx = buildDialogueContext(input);
  assert.equal(ctx.history.length, 6);
  assert.equal(ctx.truncated, true);
  assert.deepEqual(ctx.current.observations, []);
  assert.ok(ctx.current.capability_gaps.includes('emotion:unavailable'));
  assert.equal(ctx.current.transcript, input.annotation.transcript);
  assert.notEqual(ctx.persona, input.persona);
  assert.notEqual(ctx.preferences, input.preferences);
  assert.deepEqual(ctx.preferences, input.preferences);
  for (const instr of input.persona.instructions) {
    assert.ok(!ctx.current.transcript.includes(instr));
  }
  assert.equal(JSON.stringify(input), snapshot);
});

test('expression planning clones a validated draft, keeps no measured timing, and rejects a segment mismatch', () => {
  const draft = mkDraft();
  const plan = buildReplyPlan(draft, reqId(16));
  assert.equal(plan.reply_id, reqId(16));
  assert.notEqual(plan.segments, draft.segments);
  assert.deepEqual(plan.segments, draft.segments);
  const planJson = JSON.stringify(plan);
  assert.ok(!planJson.includes('start_ms'));
  assert.ok(!planJson.includes('end_ms'));
  assert.ok(!planJson.includes('duration_ms'));
  assert.throws(
    () => buildReplyPlan({ reply_text: 'AB', segments: [{ text: 'A', tone: 'warm', emotion_intensity: 0.5, pace: null, pause_after_ms: null }] }, reqId(17)),
    (e) => /could not be used/.test(e.message),
  );
});
