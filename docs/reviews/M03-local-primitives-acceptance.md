# M03 local primitives: supervisor acceptance

Status on 2026-10-01: the listed local boundaries are independently accepted; complete-round service, HTTP app, browser client and genuine emotional voice quality are not yet accepted. Owner D22 permits continued work while sleeping, official DeepSeek fallback after Qwen failures, free-only Gemini testing and no push before inspection.

## Actual verification

The supervisor ran the ignored independent scripts below against the actual source, not implementer reports. Scripts/fixtures stay under ignored .runtime/ and data/. No private audio is supplied to coding models.

| Source boundary | Command | Result |
|---|---|---|
| Conversation validators | node .runtime/qa/check-conversation-validation.mjs | 48 synthetic schema/provenance cases passed |
| Safe round errors | node .runtime/qa/check-round-errors.mjs | 22 foreign-error and cancellation cases passed |
| Bounded context | node .runtime/qa/check-dialogue-context.mjs | 13 context/length/observation cases passed |
| Expression plan | supervisor inline Node check | 4 contract/clone cases passed |
| Private audio storage | node .runtime/qa/check-file-audio-storage.mjs | 23 filesystem/bounded-read/IO cases passed |
| Native subprocess wrapper | node .runtime/qa/check-audio-tool-process.mjs | 14 child-process/cancellation/output/key-isolation cases passed |
| PCM wave normalization | node .runtime/qa/check-pcm-wave.mjs | 25 RIFF/data-boundary cases passed |
| Actual media intake | node .runtime/qa/check-native-audio-intake.mjs | 19 real-media and controlled metadata cases passed |
| Complete/partial record validation | node .runtime/qa/check-turn-record-validation.mjs | 29 cases passed |
| Expanded record resource budgets | node .runtime/qa/check-turn-record-budget.mjs | 3 shared-reference/text/accessor cases passed |
| Conversation persistence | node .runtime/qa/check-file-conversation-store.mjs | 22 restart/history/clone/playback/mode/corruption/path cases passed |

Strict npm run typecheck passed after final record-budget and storage repairs. The earlier emitted build plus all 230 historical acceptance cases passed before these additions; they will run again with the assembled application. The new checks above are supervisor-local evidence, not yet added to permanent npm acceptance suites.

## Material findings and repairs

Native intake now creates its work directory on first use and rejects malformed present metadata (including null/empty rate/channel values). The owner's human MP3 and its locally encoded WebM derivative decode successfully. Original bytes/hash are unchanged; source container duration is 5204ms and normalized sample-derived duration is 5199ms. Input decoding changes sample format/rate only, with no speed filter or intentional trimming. Human input media proves intake compatibility, not recognition/emotion accuracy. Other structural fixtures do not establish human voice quality.

Turn records preserve useful partial results and separate planned expression from actual audio alignment. Expanded shared references count toward bounded traversal and aggregate text; cycles and getters fail without being evaluated. Filesystem persistence preserves neutral/owner-authored configuration, recent chronological history and actual playback completion. Runtime modes are enforced on save and read, so development records cannot enter live history. Damaged files/configuration fail safely instead of being silently replaced.

The supervisor corrected two QA expectations: budget errors use a static UTF-16-total description; duplicate history writes reject with invalid_input, and invalid session reads return null without resolving a path. These were test expectation corrections, not weakened application checks.

## Implementers and limits

Qwen3.8-Flash wrote the earlier types/helpers/storage/process/wave files and intake repairs. D22 official DeepSeek wrote native intake, conversation validation, turn-record validation/budget repair, and conversation persistence/type-mode repair after bounded Qwen failures. Recent Qwen runs timed out after successful source reads without writing; captured events contained no billing/quota error, so the supervisor does not infer an empty balance. Every tracked file creation or repair was committed separately; intermediate failing type checks were recorded and repaired before acceptance. No Git history rewrite or push occurred.

Gemini HTTP403 API_KEY_SERVICE_BLOCKED was a metadata preflight, not an audio/generation attempt. No Gemini generation charge or real recognition result is claimed. Live Gemini testing remains deferred under the free-only constraint; dialogue/TTS model selection is still pending. Permissions rely on the owner's local filesystem/Windows ACLs and trusted configured roots; no encryption or immunity to external concurrent filesystem substitution is claimed.
