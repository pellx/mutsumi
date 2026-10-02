# M02 local ForcedAligner: new-device deployment inspection

Date: 2026-10-02 (Asia/Shanghai). Supervisor inspection; application implementer remains ChatGPT-authenticated gpt-6-luna Codex CLI.

## Acceptance status

Local official-model CPU FP32 deployment, the standalone `tools/local-aligner/align.py` worker, strict success/failure behavior and actual offline human-recorded inference are independently verified on this device. Application code was authored exclusively by ChatGPT-authenticated gpt-6-luna Codex CLI and individually committed after each write. Owner-recording/Gemini-reference comparison, acoustic boundary listening, daily conversational/noisy speech, CUDA, DirectML inference and the Node subprocess adapter remain unverified. A successful worker result is not full input-pipeline or acoustic-quality acceptance.

## This device, independently measured

Actual repository: `E:\mutsumi\mutsumi`; do not reuse old D-drive paths in application code.

- Windows 10 Pro 10.0.19045; Intel Xeon E5-2673 v3, 12 cores / 24 logical processors.
- Physical RAM 33,390,216 KiB (about 31.84 GiB). Initial free physical RAM 24,870,988 KiB; initial available commit 26,228,540 KiB. Later snapshots differ with running processes.
- NVIDIA RTX 2060, 6,144 MiB VRAM; NVIDIA driver 591.44. No AMD RX6950XT exists here. Driver-reported CUDA compatibility does not prove a CUDA PyTorch deployment.
- System-managed `C:\pagefile.sys`, allocated 2,048 MiB, initial current use zero. No owner applications were closed and no pagefile/driver/system proxy settings were changed.
- Initial free disk: C about 4.25 GB, E about 65.36 GB. Package caches and temporary installation data were directed to the project on E.
- Node 24.19.0. Python 3.12.14 from the bundled runtime created the isolated ignored `.runtime/aligner-venv`.
- qwen-asr 0.0.6, torch 2.10.0+cpu, transformers 4.57.6, numpy 2.5.3, soundfile 0.14.0. `pip check` passed; exact installed versions are retained in ignored `.runtime/qa/aligner-freeze.txt`.
- Codex CLI 0.159.2; `codex login status` and the existing Luna launcher check both confirmed ChatGPT authentication.

## Model and offline inference

Official repository `Qwen/Qwen3-ForcedAligner-0.6B`, pinned revision `c7cbfc2048c462b0d63a45797104fc9db3ad62b7`, stored in ignored `data/models/Qwen3-ForcedAligner-0.6B`. Public download used no token. Full-file download stalled at zero bytes; bounded Range chunks from the same official fixed-revision URL succeeded. Each Content-Range and byte count was verified before assembly.

Safetensors size: 1,835,544,544 bytes. SHA256: `47831d0e82f96b20e9034dba01a075ee06436654719f6a68289e49f1b65ce0e7`, matching the official LFS object identifier. No pickle weights or remote model code were used.

Supervisor script `.runtime/qa/native-pilot.py` loaded exactly one CPU FP32 model with six threads, eager attention, `local_files_only=True`, `trust_remote_code=False`, `use_safetensors=True`, HF offline/no-implicit-token settings, and blocked Python socket connections during model loading/inference. Results are official SDK native spans, not handcrafted annotations. English 48k audio was resampled with scipy polyphase filtering to 16k without time stretch/trimming; LibriSpeech 16k FLAC was decoded without resampling. Transcript content was not corrected.

| Sample | Duration | Units | Load / inference | Native result |
| --- | --- | --- | --- | --- |
| Official Qwen Chinese sample | 4.2039375 s | 13 | 4,645 / 666 ms | Valid bounds and complete lexical coverage |
| Official Qwen English sample | 15.05125 s after resampling | 36 | Same loaded model / 1,725 ms | Valid bounds and complete lexical coverage |
| LibriSpeech 1272-128104-0000 | 5.855 s | 17 | Same loaded model / 839 ms | Rejected: native item index 6, THE, 2.32 to 2.32 s |
| LibriSpeech 1272-128104-0001 | 4.815 s | 10 | 2,367 / 743 ms on a separate bounded load | Valid bounds and complete lexical coverage |

No os error 1455 occurred. This resolves the prior device's model-load blocker on this device; it does not establish that zero-duration predictions are solved. The rejected case remains intact alongside successful cases. No spans were dropped, split, averaged, interpolated or relabelled. Model-estimated native timestamps are not manually measured phonetic ground truth. No acoustic listening acceptance is claimed.

LibriSpeech is actual human audiobook reading from LibriVox, identified by corpus speaker/chapter/sample IDs and CC BY 4.0 provenance. Two fixed consecutive dataset rows were tested. The official Qwen examples lack an independent human-source attestation in the example file and are supplemental model smoke cases, not the sole proof of human-recording inference. The old owner recording and retained Gemini transcript were absent from this clone. No synthesized speech was generated, and no local recordings were sent to a coding model or cloud speech provider.

Private evidence: `data/acceptance/public-qwen/`, `data/acceptance/librispeech/`, `data/acceptance/native-pilot/` and `.runtime/qa/device-audit.json`. Private/raw native results and audio are ignored and not committed.

## Worker implementation blocker

Luna launcher invocations used the approved task, `--effort=medium --timeout-ms=600000`, original workspace-write sandbox, unelevated Windows sandbox and approval_policy=never. First run found no target directory and stopped after a failed write. Supervisor created the empty target directory. Second run's Python write raised PermissionError; its report recorded a Windows sandbox filesystem denial. Neither run created/modified a tracked file.

Read-only ACL inspection found the outer approved workspace `E:\mutsumi` has sandbox SID modify grants, while nested repository `E:\mutsumi\mutsumi` has inheritance disabled and does not inherit those grants. Normal sandboxed TypeScript emit also failed to create ignored `dist`, consistent with the repository ACL observation. No bypass/full-access coding run was used.

Proposed concrete repair: `icacls E:\mutsumi\mutsumi /inheritance:e`, preserving explicit ACL entries and restoring parent inheritance only on this repository root. Automatic approval review rejected this operation because it persistently changes repository/descendant access and the owner had not approved that exact permission change. The command did not execute. Explicit owner approval is pending; do not treat elapsed time as approval or retry indirectly.

Ignored coding reports:
- `.runtime/harness-runs/2026-10-02T01-42-34.590Z/report.json`
- `.runtime/harness-runs/2026-10-02T01-47-44.497Z/report.json`

This was the initial blocker, subsequently resolved without an ACL change as described below. No blocked/full-access coding workaround was used.

## Existing project checks

Bundled Node did not include npm. A project-local official npm package under ignored `.runtime/bootstrap` ran `ci --ignore-scripts` successfully: 112 packages installed, zero audit vulnerabilities. Its unpacked npm.cmd wrapper had incorrect self-resolution when used recursively by `npm run check`, so that command did not pass.

Supervisor instead ran the exact build/test bodies from package.json directly:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test tests/acceptance/*.test.mjs
```

With an approved supervisor execution outside the failing filesystem sandbox, build succeeded and all 287 tests passed (19 suites, zero failures/skips). No cloud calls ran. This proves existing regression behavior, not worker functionality.

## Sources

- [Official model](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)
- [Official forced-aligner example and paired transcripts](https://github.com/QwenLM/Qwen3-ASR/blob/main/examples/example_qwen3_forced_aligner.py)
- [Official SDK](https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/qwen3_forced_aligner.py)
- [LibriSpeech human audiobook corpus and license](https://www.openslr.org/12)
- [Public human-recording subset](https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy), revision `5be91486e11a2d616f4ec5db8d3fd248585ac07a`
- [OpenAI official Windows sandbox configuration](https://learn.chatgpt.com/docs/config-file/config-basic)


## Worker delivery and independent acceptance update

Owner subsequently approved the exact ACL inheritance repair, but the ordinary Windows process lacked WRITE_DAC and the administrator/UAC attempt was reported cancelled. The repository ACL was unchanged. Supervisor instead created `E:\mutsumi\aligner-worker`, an isolated local Git worktree inside the already-approved outer workspace. It inherited that workspace's existing sandbox permissions; Luna retained workspace-write, approval_policy=never and the original unelevated Windows sandbox. No coding agent ran unrestricted or as administrator. All accepted commits were taken back into the original local main branch; canonical Git blob IDs match despite checkout CRLF/LF differences.

Luna first delivered the worker, then implemented two separately tasked repairs. Supervisor immediately committed each source write before any further source edit. Initial inspection/verification rejected a valid-SDK-unit dictionary-access bug, late rejection of FLAC, missing offline protection, incomplete diagnostics and generic1455 messages. Subsequent mock verification also rejected an empty native unit list being reported as ok. These are fixed in the accepted version; no acceptance requirement was weakened.

Original local main commits (one file each):
- `5ae0e2a`: initial worker.
- `cc61132`: first repair task brief.
- `3a273f4`: strict validation, offline flags and full JSON-safe native diagnostics.
- `6f17036`: empty-result repair task brief.
- `b877671`: explicit empty native result rejection and finite checks before rounding.

Final worker Git blob: `6fabb85efa9b71bf0e044bf34e66f416a1b138b9`.

Independent checks:
- 15 CLI checks passed: stdlib-only help; unreadable/blank/invalid transcript; absent/unreadable/non-WAV/stereo/wrong-rate/non-finite/silent/over-limit audio; missing model; genuine WAV in a .bin extension; actual human native success; actual human native zero-span rejection; unavailable requested DirectML. The 10 malformed-input checks plus missing-model case ran with heavyweight imports blocked, proving early rejection rather than a later load failure. These synthetic invalid waveforms do not count as speech acceptance.
- 10 isolated mocked SDK structure cases passed after the reviewed repairs: valid result, zero span, positive seconds collapsing to zero milliseconds, NaN, lexical mismatch, empty items, numeric-string timestamp, boolean timestamp, load1455 and inference1455. Mock import/load/inference logging appeared only on stderr; stdout remained one standards-compliant JSON object. Invalid completed alignment retained all native units. NaN retained an explicit non_finite tag; no NaN/Infinity JSON literal escaped. Only affected empty/non-finite cases were rerun after the minimal second repair; unrelated checks are evidence from the unchanged reviewed paths.
- Six pure checks passed: exact numeric/plain-text preservation, exact Unicode/whitespace preservation, NFC/punctuation coverage comparison, preserved multi-character native units, direct1455 and nested1455 detection. The final pure non-finite mapping behavior was additionally checked after repair.
- Final original-main worker was independently run with socket connections blocked: LibriSpeech human sample `1272-128104-0001`, duration4815ms, 10 positive native units, status ok, exit0, CPU FP32. Actual worker load_ms15925 includes SDK import/setup; inference_ms784. The earlier worktree worker invocation recorded load_ms36057/inference_ms813. These observed startup costs differ from the SDK-only loading measurements above; no latency guarantee is implied.
- Human sample `1272-128104-0000` returned exit1/invalid_alignment and all17 native raw units, including THE at2.32 to2.32s. No unit was removed or assigned a fabricated duration. Lexical text was not corrected.

Evidence and supervisor-only scripts remain ignored: `.runtime/qa/worker-checks.py`, `worker-checks.json`, `mock-worker-case.py`, `mock-worker-results.json`, `pure-worker-checks.json`, `main-worker-offline-check.json`; real WAVs/native results remain under ignored `data/acceptance/`. Coding runs never accessed these recordings/results. Their reports were preserved under `.runtime/harness-runs/local-aligner-worktree/` before cleanup.

User confirmed D29: commit locally and synchronize with GitHub when device migration is needed. No push was performed or tested. A subsequent request to configure a Codex-only VPN proxy was cancelled by the user after they resolved it manually; supervisor only inspected settings and made no network/proxy/port-forwarding changes.

Reproduce with the project-local CPU environment after restoring the ignored model and chosen human WAV/transcript:

```powershell
.runtime/aligner-venv/Scripts/python.exe tools/local-aligner/align.py --audio data/acceptance/native-pilot/librispeech-second.wav --text-file data/acceptance/librispeech/text-second.json --language English
```

This worker task is accepted for its bounded CLI/CPU runtime scope. The complete separated input pipeline, the owner's old recording with retained Gemini text, acoustic listening and untested backends remain separate pending work. Native zero-duration predictions can still occur and must remain explicit failures.
