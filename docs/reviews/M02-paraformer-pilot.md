# Original-waveform timing calibration pilot — 2026-10-01

Supervisor acceptance: the bounded Paraformer comparison passed on the reproduced synthetic failure. The owner then selected conditional calibration: preserve Qwen text/emotion; call Paraformer once only when Qwen spoken-unit timing is missing or zero-length. Production repair is approved but not yet implemented or accepted.

## Live evidence

Original input: Windows locally synthesized Chinese speech, mono PCM16 WAV at 22050Hz, 276446 bytes, 6.267574 seconds, clip bound 6268ms. SHA-256: 770d0d2d46de947939982c09837742fe5127188627d85edb6bec8194e16cd3de. This experiment did not resample or stretch the waveform.

One model-bound temporary upload and one paraformer-v2 transcription task were used. Parameters: channel_id=[0], disfluency_removal_enabled=false, timestamp_alignment_enabled=true, language_hints=["zh"], diarization_enabled=false. Policy, upload, submission, one POST task poll, and HTTPS result download each returned HTTP200. No duplicate billed submission or retry was made. API authorization was not sent to upload/result hosts. Raw responses and remote references remain ignored in data/qa/paraformer.

Qwen and Paraformer both returned: 你好，今天我有一点累，我们正在测试语音识别。

| Check | Observed result |
|---|---|
| Full text / lexical unit sequence | Same text; all 19 lexical characters covered by both results. |
| Qwen zero intervals | Two 我 units at 1440/1440ms and 3440/3440ms. |
| Paraformer zero intervals | None; all 19 units are single Chinese characters with positive integer bounds. |
| First repaired 我 | 1460–1650ms, duration 190ms. |
| Second repaired 我 | 3230–3470ms, duration 240ms. |
| Bounds / order | All inside their sentence and the original clip; no overlapping successive units. |
| Paraformer sentence interval | 50–5570ms. |
| Retained Qwen emotion | neutral, Qwen source and original 80–5520ms observation interval. No confidence score invented. |

## Independent verification

- node .runtime/qa/probe-paraformer.mjs: exit0, pilot_passed=true. Reruns resume saved tasks/results instead of submitting again.
- node .runtime/qa/verify-paraformer-fusion.mjs: exit0. A single matched-sentence candidate with Qwen text/emotion and explicitly sourced Paraformer timings passed validateAnnotatedAudio and JSON round-trip validation. This is a feasibility check, not the production fusion algorithm.
- npm run check: strict TypeScript passed; 202 tests passed, 0 failed/skipped/cancelled. Application source was unchanged by the pilot.

## Approved repair boundaries

Only missing/equal spoken-unit boundaries trigger calibration. Malformed payloads, negative/reversed/out-of-clip times, request failures and cancellation do not silently trigger another billed task. Successful silence and valid Qwen timing do not invoke Paraformer. At most one calibration submission per analysis, under the caller's shared cancellation/deadline.

Use a new paraformer-v2-bound upload of the same original asset; never reuse the Qwen-bound temporary reference. Compare complete lexical content after explicit NFC, Unicode punctuation and whitespace normalization only. Preserve Qwen sentence text, punctuation and emotion observations. Keep actual calibration unit granularity; do not split multi-character provider words into invented character times. Reject mismatched text or boundaries that cannot map to the original sentence/unit boundaries without splitting. Segment envelopes may be derived from measured calibrated units, with an explicit derived source; emotion observation timing stays Qwen's.

Provider payload parsing belongs in Alibaba adapters. Orchestration consumes provider-independent calibration contracts; credentials, raw responses and signed references do not enter public annotations. Failure messages remain safe. Concrete application tasks and independent negative-path tests are required before accepting or pushing the repair.

The sample establishes positive, consistent provider-estimated timing on this waveform. It does not establish phonetic ground-truth accuracy, universal zero-span elimination, human emotion quality, or a running NestJS/browser voice system. Calibration adds another ASR call, upload and wait only to affected rounds; exact account charges were not measured.

Primary protocol: https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api

Temporary-upload binding: https://help.aliyun.com/zh/model-studio/get-temporary-file-url/
