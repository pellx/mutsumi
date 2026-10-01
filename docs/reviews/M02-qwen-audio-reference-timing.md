# M02 reference-conditioned Qwen Audio timing review

Status: adapter structure and defensive behavior accepted; real recording alignment quality rejected; final CLI wiring and separate Gemini emotion stage remain pending. Implementer: ChatGPT-authenticated Codex CLI gpt-6-luna; supervisor independently reviewed changes and checks. Earlier no-write repair attempts are not implementation successes. Draft type/validation defects were committed individually and repaired in later commits under the owner's per-file agreement.

## Implemented scope

- Alibaba temporary publication permits the exact selected qwen-audio-3.1-asr-flash-filetrans, preserving old model support and model-bound upload safeguards.
- New providers/aliyun/qwen-audio-timing.ts implements TimingPort: same stored waveform publication, input.file_urls + input.context reference/background data, one submission, bounded GET polling and allowlisted result download without bearer forwarding. No Paraformer API/calibration, retries, automatic provider substitution, credential reads or UI changes.
- Gemini reference is immutable authoritative text. Native units are reusable only after complete lexical equality (ignore punctuation/whitespace only), preserving provider unit boundaries and original reference substrings. No homophone substitution, ordinal relabel, interpolation or fabricated confidence. Background observations retain Gemini provenance; emotion requires the separate emotion stage.
- Invalid or over-400-codepoint context fails before publication. Shared deadline/cancellation covers publication, requests, response reads and sleep; cleanup releases reader locks/timers. Foreign failures stay static and safe. Pure generic filetrans parsers are reused from filetrans-result.ts; this is offline parsing, not a Paraformer provider call.

## Actual live pilot

One fresh Qwen-Audio task used the owner-provided 5199ms recording, unchanged stored 16k mono waveform, and retained Gemini transcript/background descriptions. Reference context was 118 Unicode codepoints. No new Gemini or Paraformer call. Policy/upload/submit/poll/result all returned HTTP200. Native output had 13 grouped word/character units, all positive and within clip; zero-duration count0. Nevertheless the recognized lexical sequence differed from Gemini reference. Fusion is rejected; positive bounds and successful API transport do not establish acoustic accuracy. The reference itself is model output, not a manually verified gold transcript. No wrong-labelled audio clips were exported or accepted.

Private responses and diagnostics remain ignored under data/qa/owner-sequence-01-2/qwen-audio-context/2026-10-01T22-57-21.780Z. Signed URLs/raw results must not be printed or included in coding prompts. The supervisor pilot called the selected API directly around the existing publication adapter; the final TimingPort adapter subsequently replayed those exact saved submit/poll/result responses locally and produced the intended safe lexical-mismatch error without further billing.

## Independent verification

- node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json: passed after final repairs.
- node .runtime/qa/check-qwen-audio-timing.mjs: 28/28 supervisor checks passed, including complete private live-response replay. Synthetic JSON transport tests do not count as real-audio quality acceptance. Script/report are ignored supervisor QA artifacts, not yet part of the tracked npm test suite.
- npm run check: build passed; all287 existing tests passed, zero failures.
- Review covers exact model/context payload, byte-for-byte reference retention, native timing source, mismatch/zero/missing/out-of-bounds rejection, preflight reference overflow and malformed data, pre-abort, expired reference, foreign result URLs, no429 resubmit, safe foreign errors, hung dependencies/body deadlines, byte caps, publication-method binding and caller asset snapshots.

No push, final CLI command, full pipeline, emotion-quality acceptance or end-to-end segmentation success is claimed. Native timing source is ASR conditioned by context, not arbitrary-transcript forced alignment. Runtime documentation: https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api .
