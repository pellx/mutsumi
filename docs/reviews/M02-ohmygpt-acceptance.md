# OhMyGPT input-analysis review — 2026-10-02

Supervising Codex accepts the offline adapter/wiring and the latest real-audio transport/structure checks. The new credential works and the authorized owner recording returned 17 valid timed units. Transcript accuracy, acoustic timing accuracy and emotion quality remain unaccepted pending owner review. Dialogue and TTS providers are still unselected. No push was performed while owner inspection is pending.

## Implementation and boundary review

Qwen3.8-Flash, through the restricted Codex CLI harness, implemented `apps/server/src/providers/ohmygpt/ohmygpt-audio-analysis.ts`, the edits to `apps/server/src/application/runtime.ts` and `apps/server/src/main.ts`, and `tests/acceptance/ohmygpt-audio-analysis.test.mjs`. Supervisor-owned changes cover `.env.example`, the credential launchers and task/review documents. Each tracked-file write was committed separately. Some Qwen runs timed out read-only; the first adapter-writing run timed out after its successful typecheck. Independent review, not that run's final status, establishes acceptance. DeepSeek was not used for these changes; the owner's latest replacement agreement now permits its fallback again.

One stateless POST requests exactly `gemini-3.8-flash`. Provider payloads stay inside the adapter. The ordinary route uses no undocumented Flex or OpenRouter routing parameters. The local model schema is converted to the documented OpenAPI subset without mutating the shared schema; the strict pure result mapper still validates words/subwords, integer positive clip-relative times and candidate segment emotion. It rejects missing/zero/inconsistent timing, refused/truncated/tool output and unexpected model labels. It never averages missing times, drops words, uses website transcript hints or invokes Alibaba fallback.

The fork retains the original adapter's byte, native Blob, metadata, opaque-key, shared-deadline and bounded-response checks. Seven inherited validation/deadline/cleanup sections were independently compared and are identical. Supervisor tests found a missing guard for message-level tool/refusal fields; Qwen repaired it in a separate committed edit before acceptance. Timing provenance remains `model-estimate-not-forced-alignment`. A returned model label alone is not upstream authenticity evidence.

The launcher parses only selected-provider settings as data, passes no other provider/coding credentials, and leaves mock mode isolated. A discovered OpenRouter-formatted credential in the OhMyGPT slot prompted a supervisor launcher guard: `sk-or-v1-` values fail before startup with a static, secret-free error. This guard recognizes one known foreign-key format, not every possible wrong or revoked credential. No secret value is stored in this report or committed fixtures.

## Checks actually run

| Command / evidence | Result |
|---|---|
| `npm run check` after wiring and tracked regression fixtures | Build passed; 287 tests passed, 0 failures. |
| `node .runtime/qa/ohmygpt-acceptance.mjs` | 24 independent offline cases passed after repair. |
| `node .runtime/qa/check-ohmygpt-launcher.mjs` | 15 cases passed, including after the foreign-key guard. |
| `node .runtime/qa/check-ohmygpt-key-origin.mjs` | Known OpenRouter prefix rejected before startup; no secret echo or cloud request. |
| `node .runtime/qa/check-ohmygpt-runtime.mjs` | 13 cases passed; no cloud startup calls or credential fallback. |
| `node .runtime/qa/check-ohmygpt-bootstrap.mjs` | 5 named-environment cases passed; mocks read no cloud credentials. |
| `node .runtime/qa/check-main-boundaries.mjs` | 7 HTTP/header/error cases passed. |
| `node .runtime/qa/check-http.mjs` | 20 HTTP/storage/intake cases passed with explicitly labelled local mocks. Human input was retained; fixed mock text is not recognition. |
| `npm run build` after the owner's reboot | Passed; no application-code changes since the accepted test run. |

## Live attempts and current blockers

Direct OhMyGPT connection returned no HTTP response for the owner-recording attempt. A credential-free direct network probe failed with `UND_ERR_CONNECT_TIMEOUT`; the same public metadata endpoint through the already-running local proxy returned HTTP200. The proxy is now configured in ignored root `.env` as `OHMYGPT_PROXY_URL=http://127.0.0.1:7890`, for the selected child only. No global network/proxy setting was changed.

Automatic approval review initially rejected the proposed proxy-based submission of `序列 01_2.mp3`: selecting the provider and supplying a key were not considered explicit authorization for this particular sensitive recording to OhMyGPT. The supervisor asked for that permission and did not bypass the rejection. On 2026-10-02 the owner explicitly agreed to send the recording to OhMyGPT. That authorization persists; do not ask again. The wrong-provider credential was the subsequent blocker, resolved by the owner's replacement key. Both ignored live QA launchers reject the known OpenRouter prefix before any cloud call as well.

An unaffected, safer pilot instead used the publicly licensed **original human** AISHELL-3 `raw2.wav`, through NestJS upload, native intake, real adapter and local record storage. Its source is https://sos1sos2sixteen.github.io/aishell3v2/audios/raw/raw2.wav ; the primary dataset sample page distinguishes original dataset recordings from its separate synthesis section: https://sos1sos2sixteen.github.io/aishell3v2/ . Apache-2.0 corpus/license information: https://www.openslr.org/93/ . The original file's SHA-256 was checked before submission; reference text was not sent. This is studio read speech, not acceptance under natural conversational pauses, accents, background noise or emotional variation.

That one proxy request returned **HTTP401**, no returned model label and no annotation. The local credential-shape check found an OpenRouter-specific prefix in `OHMYGPT_API_KEY`, with no whitespace or placeholder marker. This points to a provider credential mismatch; it is not a measured balance/quota result. The credential had been sent to the selected relay during this public pilot. The owner was informed and asked to replace it with a key generated by OhMyGPT. No further use of that credential is authorized by this report.

Ignored evidence: `data/qa/owner-sequence-01-2/ohmygpt/2026-10-01T19-47-07.959Z/` and `data/qa/human-live/ohmygpt/2026-10-01T19-53-32.304Z/`. Raw responses and conversation records remain in ignored `data/`; coding agents received neither recordings nor provider responses.

These historical failures do not represent the current credential or live transport status. Provider failure never justifies changing the selected model, auto-fallback, billing activation or topping up.

## New credential, schema repair and owner-selected output ceiling

The owner filled a replacement key without the known foreign prefix. One authorized private-recording request then returned HTTP400: an enum schema node lacked an explicit type. Qwen repaired only the adapter's fresh local wire-schema conversion, adding string types to nonempty all-string enums while preserving existing types, nullable conversion, enum values and the shared schema. The supervisor independently inspected the emitted schema's 12 nodes, then Qwen persisted the regression in a separate single-file commit. `npm run check` passed all 287 tests.

The next bounded request returned HTTP200 and the selected model label, but empty unit data and inconsistent segment/transcript text. The strict mapper correctly rejected it. Reported completion usage was 4002 tokens: 3928 reasoning and 74 visible output tokens. This suggested budget pressure, but did not prove its sole cause. The owner explicitly rejected the supervisor's 4096 cost ceiling and chose the selected model's full output limit. Qwen changed only `max_tokens` to **65536**, preserving `reasoning_effort: low`; the test assertion was updated separately. All existing timeout/byte/validation/no-retry boundaries remain. Primary specifications: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/ and https://ai.google.dev/gemini-api/docs/thinking . The model supports low/medium/high thinking; minimal is unsupported. A response ceiling is not a requested token count.

One subsequent owner-recording run passed through actual NestJS multipart intake, same-waveform 16kHz mono analysis WAV, the relay adapter, strict mapper and conversation storage. HTTP200 reported `gemini-3.8-flash`; the record contains **3 segments and all 17 character units**, each with positive in-clip bounds (180–510 ms). These are readable character units, not Gemini's private vocabulary token IDs. Segment-level emotion candidates are preserved. Reported usage: 637 input tokens; 1550 completion tokens (599 reasoning +951 visible); total 2187. This is reported API usage, not independent invoice verification or proof of upstream model identity. Higher ceiling and lower actual usage in this one rerun do not establish a deterministic causal improvement.

The round then failed at **dialogue/provider_unavailable**, because dialogue and TTS are unselected. Input annotation and originals were retained. The supervisor explicitly flagged unnatural-looking transcription for owner comparison with the recording; structural validity does not establish recognition accuracy. Timing remains a model estimate, with no verified forced alignment, and segment emotion candidates remain uncalibrated.

Ignored evidence is in `data/qa/owner-sequence-01-2/ohmygpt/2026-10-01T20-08-57.081Z/` (schema rejection), `2026-10-01T20-20-45.995Z/` (empty-unit result) and `2026-10-01T20-28-55.381Z/` (17-unit structural success). Actual conversation text, raw responses, annotated data and audio stay in ignored `data/`; implementers received only generic defects and synthetic fixtures.

## Final local checks and owner inspection

- `npm run check` after the 65536 change: build passed, **287/287 tests**, 0 failures. Qwen's child `node --test` worker was sandbox-blocked; its direct in-process test ran, and the supervisor separately executed the complete real test runner successfully.
- `python .runtime/qa/export-gemini-owner-review.py`: exported **17 WAV clips** and a manifest/archive. Every output clip's decoded PCM is exactly the corresponding frames from the submitted analysis WAV; original bytes and analysis SHA-256 matched. Exporting does not validate whether the model selected the correct speech boundaries.
- `node .runtime/qa/verify-gemini-owner-review.cjs`: all 17 unit controls and audio play events passed, each WAV duration matched its interval, no page errors or overflow at 736/320 widths. The supervisor repaired a local preview state-echo interruption before rerunning and inspecting both screenshots. No extra cloud call was used for export or display.
- `npm start`: local live service remains at `http://127.0.0.1:3000/`; page/health and the saved 17-unit record returned HTTP200. Health correctly reports configuration only, not a blanket quality guarantee; dialogue/synthesis remain unavailable.

Owner inspection is now possible via the local test page, the inline original-and-unit audio review and the ignored clip archive. Recognition/timing/emotion quality and the full voice dialogue goal remain pending. No additional provider, synthesized input, web transcript hints or push was introduced.
