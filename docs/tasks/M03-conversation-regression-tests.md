# M03 permanent conversation/orchestration acceptance
Create ONLY tests/acceptance/conversation-round.test.mjs once; no other edit/Git, no .env/data/.runtime/harness, no cloud or real recordings. Qwen primary. Use node:test + node:assert/strict, direct imports ../../apps/server/src/... .ts (these non-decorated modules run through Node25 type stripping). Synthetic structural fixtures ONLY, no synthesized speech or fake live quality claim.
Read ONLY domain/conversation.ts, application/conversation-ports.ts, application/analysis-ports.ts, application/round-errors.ts, public helper export signatures dialogue-context/expression-plan and RoundService constructor/submit/getJob/getTurn/markPlaybackCompleted; domain/annotation.ts AudioAsset/AnnotatedAudio type definitions ONLY (not validatorinternals). Synthetic fixture constructs1000ms mono16k WAV metadata with distinct UUIDv4 source/input/output, source key==ID. Annotation schema has two words valid positive times, no observed emotion and unavailable capabilities, readable transcript. No mediafile creation/network. Fake port fixture records calls and owns only explicit arrays/maps, default neutral persona/preferences/history; fake synth output alignment:null, empty controls, canonicalUUIDkey. Use makeRoundError for intentional controlled failures; errors externally thrown PRIVATE string must be sanitized.

Meaningful independent behavior tests (prefer12..16 tests):
- complete round sequences each port once, stores once, valid record/playbackfalse; planned expression doesn't become actual timing.
- same clientID/identical bytes returns same job even busy, provider calls once; changed input same ID invalid_input.
- new ID while pending round busy; deterministic gate/release, no flaky sleeps except bounded terminal poll.
- caller mutating submitted bytes/public job snapshot cannot alter accepted snapshot/job.
- unavailable analysis records original/normalized assets and explicit gap; skips dialogue/TTS, persists partial.
- malformed/missing/zero timestamps invalid_result, never fabricate time or proceed dialogue.
- foreign failure safe static message no PRIVATE/providermetadata.
- noncooperative analysis deadline stops and late completion cannot change terminal job; observe late promise.
- failed save retains valid public partial/complete result with persistedfalse and storage_failed; no retries.
- public returned record has no storage_key/raw payload or paths.
- wrong-mode session rejected; badrequestID/oversize pre-port; bounded input clone doesn't hide invalid data.
- playback staysfalse until explicit markPlaybackCompleted with generatedoutput, store mark idempotent if fixture supports.
- context validates/bounds last6history/truncation and leaves persona/preferences/user evidence separate; preserve input object.
- expression helper clones validated draft, rejects segments mismatch and doesn't create measured timings.

Each test has substantive assertions and cleanup; avoid tests mirroring private constants/internal functions. Poll enddeadline2s and terminal getJob; service deadline test30ms..80ms enough headroom, no private monkeypatch/global clock/env. Snapshot fixtures clone; no exception swallowing/unconditional pass. No tests knowingly expected to fail. Build fixture from public types; if interface mismatch report instead of editing source. One successful write then node --test tests/acceptance/conversation-round.test.mjs; stop and report actual failures. Supervisor independent existing checks remain authoritative; this is regression coverage, never human recognition acceptance.

