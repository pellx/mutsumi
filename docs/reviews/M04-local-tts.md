# M04 local Qwen3-TTS trial acceptance (2026-10-02)

Accepted scope: standalone offline CPU FP32 preset-voice artifact synthesis. Chinese intelligibility, complete-text delivery, intended emotion, chosen persona voice and interactive latency suitability are NOT accepted. Owner input-audio listening remains deferred. No Gemini/Jev calls, private recording clone or provider/round wiring in this task. Generated output is explicitly TTS, never human-input ASR/alignment acceptance.

## Choice and current device

Official Qwen3-TTS1.7B CustomVoice supports built-in Chinese voices and instruction control; the0.6B variant has no instruction-control support in the official model table. Start Serena, fixed Chinese. This is a practical advanced candidate, not a universal SOTA claim. Primary source https://github.com/QwenLM/Qwen3-TTS . IndexTTS2.5 released2026-08-10 with expression/speed controls (https://github.com/index-tts/index-tts); its HF repository5,491,182,363bytes plus dependencies exceeds current disk. FishS2Pro official4B weights/repository11,011,629,649bytes likewise exceeds disk (https://github.com/fishaudio/fish-speech). New Luna-TTS/Qwen-Audio3.0 papers were considered; no deployable local package/weights verified in this trial. Published latency on other GPUs is not this device performance.

Rechecked Windows device: XeonE5-2673v3,12cores/24logical; RTX2060 total6144MiB/driver591.44, about5GB free at latest pre-trial snapshot (earlier snapshot lower, varies). RAM33390216KiB total/free24395372KiB before inference. Existing C pagefile2048MB, current192MB/peak398MB at snapshot; no change. C-disk about1.1GB free, E about5.5GB before deployment and801,873,920bytes after model download. During model load free physical16104620KiB/freevirtual9908176KiB; no observed pagefile/OOM failure. No CUDA installation, driver/proxy/global config changes or unrelated deletion.

## Pinned local deployment

Model data/models/Qwen3-TTS-12Hz-1.7B-CustomVoice, official HF revision0c0e3051f131929182e2c023b9537f8b1c68adfe; all files about4.52GB. Download used ModelScope official-model byte mirror for large ranges and HF metadata; final official LFS SHA256 checks passed. No duplicate large cache.

- model.safetensors3833402552bytes, SHA25638b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137.
- speech_tokenizer/model.safetensors682293092bytes, SHA256836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258.
- Official config tts_model_size is1b7, not1.7b. Official tokenizer files merges.txt/vocab.json, not invented tokenizer.json/processor_config.json.

.runtime/tts-venv isolates qwen-tts0.1.1,transformers4.57.3,onnxruntime1.24.4. Readonly .pth reuse of existing aligner and separator site-packages supplies Torch2.10.0+cpu,torchaudio2.10.0+cpu,accelerate1.12.0,einops0.8.2,numpy2.5.3,soundfile0.14.0,librosa1.0.0,sox1.5.0. Existing environments were not upgraded. Absolute .pth entries must be rebuilt on migration; do not copy Windows venv as portable. Missing FlashAttention/SoX executable warnings were emitted by optional imports; successful built-in preset synthesis did not require either. Do not infer cloning/resampling capabilities from that.

## Implementer and independent checks

ChatGPT-authenticated gpt-6-luna CLI authored tools/local-tts/synthesize.py under restricted workspace-write in E:/mutsumi/local-tts-worker; each successful target write immediately committed separately. Supervisor identified/corrected initial brief config-size error and rejected first draft invented file names, missing version checks, permissive sample-rate coercion and close/reopen output race. Failed anchor-repair run made no edits; verified whole-file repair and one-line Windows JSON stdout repair completed. Final main source commits81ce9d1,146dc25,c38384d; intermediate docs separate.

34 independent structural checks on main passed: exact request preservation and bounded JSON/schema/control/duplicate checks, real floating waveform/rate/finite/duration validity, official file layout/hash failure, static runtime/model failures, request/output bounds, exclusive raced WAV/manifest preservation, own partial-file cleanup, offline load flags/stdout isolation and ASCII JSON exact Chinese roundtrip. Two actual Windows junction path checks passed. Total36 checks; mocks are structure-only, not real TTS quality. Bundled Python dependency-free --help passed. TypeScript code unchanged; broad existing regression was not rerun for this standalone Python change.

Evidence ignored .runtime/qa/tts-worker-checks.py,tts-worker-results.json,tts-junction-results.json,tts-worker-live-inspection.json,tts-wave-inspection.json,tts-browser-audio-check.json; deployment manifests .runtime/tts-bootstrap/model-download-manifest.json,runtime-manifest.json. Coding logs retained under .runtime/harness-runs/local-tts-worker.

## Actual local synthesis

Original fictional test sentence: 你好，我是睦。今天想先聊聊什么？我会认真听你说。 This is not a recovered owner transcript or accepted final persona. Same built-in Serena voice, different requested expression instructions; stochastic generations are not a calibrated controlled emotion benchmark.

| Artifact | Frames/rate | Measured duration | Inference | Load | Peak |
|---|---|---|---|---|---|
| gentle-pilot, 温柔平静指令 |117120/24000|4.88s|48.452s|4.099s shared initial load|0.273339|
| cheerful-pilot, 开心轻快指令 |103680/24000|4.32s|42.061s|same loaded model|0.285124|
| formal worker-gentle |142080/24000|5.92s|57.735s|14.515s includes imports/load|0.442964|

All outputs finite nonempty mono24000Hz FLOAT WAV; no normalization/trimming/padding/clipping/time-stretch. Independent SoundFile readback matches frames/UTF8 text; Edge native audio metadata readyState4/errornull and exact durations for all three. Pilot disallowed socket connects after imports, both synthesis calls succeeded offline. Worker sets HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE, uses local_files_only/safetensors/no remote trust and fixed CPU FP32/eager attention.

Private artifacts: data/acceptance/local-tts/{gentle-pilot,cheerful-pilot,worker-gentle}/output.wav, corresponding pilot.json or synthesis.json; request files beside them. Token budget256; wrapper EOS/full text completeness not inspected, so completion=not_verified. No word timestamps, claimed achieved emotion or measured pace/pause/intensity.

CPU RTF about9.7..9.9, roughly10seconds compute per second of output: useful for offline listening, not currently suitable for fluent dialogue. GPU/memory/offload acceleration is separate future deployment; current E free<1GB cannot accommodate another full CUDA Torch stack. Owner should listen for full words, pronunciation/pauses, noise/distortion and expression difference before choosing final voice. No quality claim until owner review. No push.
