# M02 conditional timing repair — supervisor acceptance

Date: 2026-10-01. Supervisor: Codex. This repair was implemented by qwen3.8-flash through the restricted Codex CLI harness, with separate supervisor review and execution. Historical adapter implementation is documented in the earlier reviews. D20's conditional repair is accepted for the provider-adapter and annotation scope; owner inspection is pending. The owner requested inspection before further modules or a push, so no milestone push was made.

## Result and boundaries

Qwen remains primary for text and sentence emotion. Only a fully inspected speech result whose timing is missing or zero-length invokes one additional Paraformer calibration. Native valid timing and silence skip calibration. Invalid structures, reversed/out-of-clip bounds, lexical inconsistencies and HTTP failures do not trigger a second analysis.

Temporary uploads bind independently to the selected approved model. Paraformer uses its plural input/result protocol and POST polling. The original Qwen operation's cancellation and deadline also cover calibration, including a dependency that ignores the signal. No automatic resubmission or recursive calibration is permitted.

Fusion verifies the same asset, explicit Paraformer timing provenance, complete lexical coverage and compatible unit boundaries. NFC plus punctuation/whitespace removal is used only for lexical comparison. Actual calibrated units are copied at their supported granularity; incompatible grouped words fail rather than being split or averaged. Qwen text, emotion label and original emotion interval remain intact. A segment envelope derived from units is explicitly sourced as such.

## Independently executed acceptance

- Final `npm run check`: strict TypeScript on all five current TS modules and all five acceptance files; **230 passed, 0 failed/skipped/cancelled**. The new timing-calibration file contributes 28 named groups, including missing/equal timing, eligibility, lexical/unit boundaries, both-model binding, class-method capture, timeout/cancellation, foreign-error isolation and child-task failure.
- `node .runtime/qa/check-calibration-mapper.mjs`: saved live synthetic Qwen/Paraformer responses fused into 19 positive units; 12 negative variants rejected; accessors were not executed and input JSON remained unchanged.
- `node .runtime/qa/check-calibration-transport.mjs`: offline replay through the production adapters, one calibration call, correct Paraformer submission/POST poll/result download, both publication model bindings, valid final annotation. This check itself made no network calls.
- `node .runtime/qa/check-conditional-live.mjs`: one new bounded real API exercise on the unchanged local synthetic waveform. Qwen and Paraformer each received one submission. All ten policy/upload/submit/poll/download stages returned HTTP200; calibration called exactly once. Validated output contains 19 positive intervals and zero zero-duration units.
- Independent comparison of the newly saved raw Qwen result and final annotation confirmed identical full/sentence text and retained emotion label/source/original bounds. Qwen again returned two zero-duration units before fusion.
- `node .runtime/qa/verify-review-widget.cjs`: local headless Edge with Chromium sandbox enabled verified 19 selectable units, both repaired durations, actual audio loading, selected-word playback, widths 736/320, no horizontal overflow or page script errors. This is a supervisor inspection display, not the product recording UI.
- `node --check tools/harness/run-qwen.mjs` passed. Tracked files contain no `.env`, `data/` or `.runtime/` assets; a key-pattern check emitted no file names.

The first parallel execution of two Node verification commands hit a local V8 memory-allocation failure before tests ran. Each check passed on a subsequent serial execution. The exact transient memory cause was not established; it was not treated as a product pass or an Alibaba quota error.

## Actual sample

The QA clip is locally synthesized Chinese speech, 276446 bytes, PCM16 mono 22050Hz. Decoded duration is 6.267574s; asset duration is the ceiling 6268ms. SHA256: `770d0d2d46de947939982c09837742fe5127188627d85edb6bec8194e16cd3de`.

| Unit | Raw Qwen interval | Calibrated interval | Positive duration |
|---|---|---|---|
| First 我 | 1440–1440ms | 1460–1650ms | 190ms |
| Second 我 | 3440–3440ms | 3230–3470ms | 240ms |

Text: 你好，今天我有一点累，我们正在测试语音识别。 Qwen sentence emotion remains `neutral`, 80–5520ms. The unit-derived sentence envelope is 50–5570ms. Timing and emotion retain their different sources. Private raw responses and final output are retained only in ignored `data/qa/conditional-live/`.

## Review findings and coding-run limits

Supervisor rejected acceptance of an initial fusion type error and an import-only publication patch caused by LF/CRLF mismatch; both were separately committed and repaired by Qwen. The new tests initially had one incorrect no-port expectation (zero timing expected to be missing timing). Qwen corrected the fixture and added meaningful calibration-boundary error assertions; no product invariant was relaxed.

Coding runs also encountered unsuitable Windows commands and the Windows approximately 32KiB process-command limit. The launcher now provides native PowerShell, bounded command-size and exact-match/pre-write checks. Its configurable hard timeout extends to 20 minutes. These are supervision guidance and bounds, not a guarantee that arbitrary generated commands or tasks will succeed.

One earlier parser-repair invocation created and removed an unassigned temporary verification script. That was a procedural deviation, not a compliant scoped write; the supervisor independently verified the resulting source, and subsequent launcher prompts explicitly forbid temporary verification files. No credential/private audio read or cloud call by the coding model was observed. Several runs performed more source discovery/read-back than brief guidance requested; these do not establish hidden model concurrency or quota exhaustion.

## Agent-limit diagnosis

The configured coding route is the general Alibaba Beijing compatible API, `dashscope.aliyuncs.com/compatible-mode/v1`, with one Qwen coding run at a time. Token Plan has a separate Key/Base URL and publishes suggested Agent concurrency by subscription tier; its suggestion does not apply to this configured route. General API quotas are shared by account/model and excess requests can return HTTP429. Completed coding reports examined here contain no logged rate/quota/concurrency error; earlier no-write stops were launcher timeouts. Global service load or the owner's actual console limit cannot be inferred from the absence of errors alone.

Sources checked: [Token Plan FAQ](https://docs.agent.bailian.aliyun.com/zh/token-plan/token-plan-personal-faq), [general rate limits](https://help.aliyun.com/zh/model-studio/rate-limit), [dynamic quotas](https://help.aliyun.com/zh/model-studio/quota-management).

## Owner review boundary

Accepted evidence is one synthetic waveform plus offline regressions. It does not establish phonetic ground truth, universal calibration success, or human emotion-recognition accuracy. Mismatched or invalid calibration still fails explicitly. NestJS intake, recording UI, dialogue, TTS and persona/memory wiring remain separate work. The current delivery is ready for the owner's timing inspection; further module work and push await the owner after that inspection.
