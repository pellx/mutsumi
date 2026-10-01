# OhMyGPT input-analysis review — 2026-10-02

Supervising Codex accepts the offline adapter and wiring. Live recognition remains unaccepted: the current credential fails authentication. Dialogue and TTS providers are still unselected. No push was performed while owner inspection is pending.

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

Automatic approval review rejected the proposed proxy-based submission of `序列 01_2.mp3`: selecting the provider and supplying a key were not considered explicit authorization for this particular sensitive recording to OhMyGPT. The supervisor asked for that permission and did not bypass the rejection. Private proxy submission remains pending owner authorization.

An unaffected, safer pilot instead used the publicly licensed **original human** AISHELL-3 `raw2.wav`, through NestJS upload, native intake, real adapter and local record storage. Its source is https://sos1sos2sixteen.github.io/aishell3v2/audios/raw/raw2.wav ; the primary dataset sample page distinguishes original dataset recordings from its separate synthesis section: https://sos1sos2sixteen.github.io/aishell3v2/ . Apache-2.0 corpus/license information: https://www.openslr.org/93/ . The original file's SHA-256 was checked before submission; reference text was not sent. This is studio read speech, not acceptance under natural conversational pauses, accents, background noise or emotional variation.

That one proxy request returned **HTTP401**, no returned model label and no annotation. The local credential-shape check found an OpenRouter-specific prefix in `OHMYGPT_API_KEY`, with no whitespace or placeholder marker. This points to a provider credential mismatch; it is not a measured balance/quota result. The credential had been sent to the selected relay during this public pilot. The owner was informed and asked to replace it with a key generated by OhMyGPT. No further use of that credential is authorized by this report.

Ignored evidence: `data/qa/owner-sequence-01-2/ohmygpt/2026-10-01T19-47-07.959Z/` and `data/qa/human-live/ohmygpt/2026-10-01T19-53-32.304Z/`. Raw responses and conversation records remain in ignored `data/`; coding agents received neither recordings nor provider responses.

Next live acceptance requires a valid OhMyGPT-issued credential and, for the owner's recording, explicit destination-specific audio authorization. Validate native audio/schema passthrough, transcript quality, meaningful positive unit timing, candidate emotion, usage/billing and browser display before claiming usable recognition. Provider failure at this stage does not justify changing the selected model, auto-fallback, billing activation or topping up.
