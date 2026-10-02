# M02 local ForcedAligner: new-device deployment inspection

Date: 2026-10-02 (Asia/Shanghai). Supervisor inspection; application implementer remains ChatGPT-authenticated gpt-6-luna Codex CLI.

## Acceptance status

Local official-model CPU FP32 deployment and actual offline speech inference are verified on this device. The application worker is NOT implemented or accepted: both Luna runs stopped without creating `tools/local-aligner/align.py`. The second run was denied by the Windows workspace-write sandbox. Owner-recording/Gemini-reference comparison, acoustic boundary listening, daily conversational/noisy speech, CUDA, DirectML and the Node subprocess adapter remain unverified. Do not interpret SDK results as worker or full input-pipeline acceptance.

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

After authorized permission repair: rerun the same Luna task; immediately commit its one target write; independently inspect/retest the worker, especially pre-load input rejection, strict one-JSON stdout, offline loading and raw invalid-span retention using the known native THE zero-span case. Repair application code through Luna one file/write/commit at a time. Do not advance to the Node adapter or claim module acceptance before this completes.

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
