# M02 reference-free automatic sentence worker (2026-10-03)

Owner's D41 clarification: the three wardrobe parts are a QA target, not runtime input. Previous supervisor QA script independently proposed parts, but reused a sample-specific precomputed crop refinement. This review supersedes any claim that the earlier script established a generic complete automatic worker.

New application tools/local-aligner/sentences.py was authored by ChatGPT-authenticated gpt-6-luna CLI. Main commits4b8e877(initial),7d21e22(reviewrepair),f42c5e9(shared-ownershiprepair), each immediately and individually committed after its physical write. Supervisor reviewed source, independently tested, and only then merged. No code from another model or handwritten supervisor application logic.

## Runtime behavior and boundaries

CLI input audio mono16k actual WAV <=120s, plaintext or exact JSON object containing only transcript, new/empty output directory, generic threads/pause threshold/crop margin/model path. No reference sentence list, expected count, case name, cached alignment or desired times accepted. JSON extra reference/count fields are rejected before loading. Source contains no owner names, transcript snippets, acceptance-file paths,119200sample or7.45s constants. RATE16000 is the validated input format, not a sample-specific cut.

One local Qwen3ForcedAligner CPU FP32/eager model loads once; first real whole-clip inference determines native units. Multiple terminal-punctuation spans use exact existing transcript punctuation; otherwise local native-gap module derives parts (default600ms). Original text/whitespace/punctuation retained. This is candidate sentence grouping, not a general proof that every pause is semantic sentence end.

Each eligible unavailable sentence automatically derives an inference window from its first owned native start minus generic margin(default150ms), through next sentence native first start or actual clip end. Only its own exact text is crop-aligned once using the same loaded model. Invalid/unavailable native edges stay unavailable if refinement fails; inference window is not an invented boundary. Only native local edges plus actual sample offset can become final candidates. Full raw/coarse/crop maps and rejection/window evidence retained. Shared native words are rejected regardless of whether mapper's final reason is crossing-word or overlap. Final overlaps invalidate both involved bounds. Candidate WAVs use exact returned sample slices, exclusive xb output; existing/concurrent files are preserved. Result ok/partial is truthful, no fake fallback or word emotion/end generation.

## Independent checks

.runtime/qa/automatic-sentence-worker-checks.py:23/23passed. Synthetic provider mocks explicitly labelled; real supplied audio is used for file intake but synthetic unit times do NOT establish recognition quality. Tests include load-once, automatic pause text grouping, first and last sentence generic refinement, derived sample window and offsets, retained coarse/crop evidence, unresolved partial/no WAV, shared word rejection, strict reference/count input rejection, bad CLI values/forbidden cached-argument, no case constants and concurrent file introduced after validation preserved unchanged.

Review caught unsafe path-based WAV writes, insufficient ownership eligibility, and default punctuation use in crop map. Luna repaired these; initial independent crossing-word mock still failed because mapper can override crossing reason with overlap. Final repair counts unit ownership across sentences;23checks pass afterward. These are actual failures retained in reports, not waived tests. Readonly ast.parse checks passed. No unrelated TypeScript tests rerun for isolated Python worker; prior287result remains historical.

## Fresh human-recording acceptance independent of reference

Private data/acceptance/automatic-sentences-001 stages neutral input filenames audio-1.wav/text-1.json and audio-2.wav/text-2.json from existing separated human recordings. Child command contains only these inputs/output paths/threads; runtime reads no old cached alignment or refinement. Supervisor .runtime/qa/automatic-sentence-audit-run.py runs the actual MAIN worker with a Python open audit: any other private data or .env read is forbidden, model/input/output reads allowed. Native library I/O is not claimed universally intercepted; source review and explicit data API independently establish no reference use. Both per-run audit files record zero blocked/forbidden reads. Supervisor target comparison executes only after BOTH child processes exit. Reference never sent to coding model or runtime Qwen.

Actual CPU model inference results:

| Case | Sentences | Full command wall time | Model load | Coarse inference | Automatic crop refinement |
|---|---|---|---|---|---|
| fumo | 7 | 25.9473868s | 16741ms | 3914ms | none required |
| wardrobe | 3 | 23.9318137s | 17132ms | 1385ms | one, third sentence |

Both statusok; every emitted WAV finite mono16k and frame count exactly equals end_sample-start_sample. Wardrobe exact sentence texts equal owner's target after-run comparison. Native gap candidates720/1440ms; third inference window119200..158407samples is computed by worker from NEW coarse units and margin, not supplied by QA. Final original-clock boundaries0..2560ms,3280..6160ms,7610..9850ms. Earlier manual-target/cached pilots remain separate history.

New output WAV container bytes differ from prior files; decoding proves every fumo/wardrobe cropped FLOAT sample/rate/shape exactly equal to prior corresponding crop. Do not claim byte-identical WAV containers. This connects fumo's previous positive owner listening feedback to the reproduced waveform, without manufacturing a transcript reference or general audio-quality score. Current wardrobe cut listening remains pending.

Private acceptance.json, output-1/output-2/sentences.json, stdout/stderr, per-run io-audit and independent-output-comparison.json preserve evidence. QA reports/logs are ignored, no private transcripts in tracked fixtures. New local listening page http://127.0.0.1:8769/ serves these actual fresh outputs; script .runtime/qa/automatic-sentence-listening-server-final.mjs, static data/acceptance/automatic-sentences-001-listening-final.html. Edge12/12 audio metadata passed; page labels runtime independence and decoded-sample equality accurately. Browser readiness is not phonetic boundary acceptance.

Accepted: reusable local worker automatically derives/refines sentences on audio+transcript with target absent at runtime. Outstanding: full original-scene/separation/ASR production orchestration and UI entry, broader unseen-material validation, character onset inference and input emotion. Threshold remains tunable, not trained/generalized from two examples. New seven clips remain intake-only/deferred; no cloud requests, model downloads, TTS/Jev change or push. Luna reports copied/hash-verified before own clean worktree removal; unfinished Jev worktree preserved.
