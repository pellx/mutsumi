# Mutsumi initial architecture

Confirmed stack: TypeScript, local Node backend using NestJS, browser UI. Module/provider details below are proposals until their task is released. Input annotation contracts are implemented independently of NestJS; cloud speech/dialogue/TTS providers remain unselected.

## Product behavior

Single-user prototype: record → submit → analyze → generate reply → plan expression → synthesize → play. New recording is disabled while a round is processing or playing. Failures return the UI to a usable state with a retry option. This is a simple sequential UI state, not real-time voice turn detection.

The browser records audio and displays/plays results. A local backend owns credentials, cloud calls, validation, storage, and orchestration. Business providers are selected before their adapters are implemented.

## Proposed module boundaries

| Module | Input | Output | Responsibility boundary |
|---|---|---|---|
| Recording UI | User recording controls | Audio blob + reported media type | No cloud credentials or direct provider calls. |
| Audio intake | Uploaded clip | AudioAsset | Validate real format/size/duration, store original, optionally normalize. Do not infer emotion. |
| Transcription | AudioAsset | Transcript | Text plus timing at genuinely supported granularity; optional alignment is a separate operation. |
| Audio observation | AudioAsset | Observation[] + capability status | Detect emotion/prosody/events with provenance; preserve uncertainty and overlaps. |
| Annotation fusion | Asset, transcript, observations | AnnotatedAudio | Align to one clip-relative clock and validate references/time intervals. |
| Context builder | Annotation, persona, memories | DialogueContext | Bound context size and distinguish quoted user data from system instructions. |
| Dialogue generation | DialogueContext | ReplyDraft | Generate text and intended response style; do not claim to synthesize audio. |
| Expression planning | ReplyDraft + relevant context | ReplyPlan | Plan by sentence/phrase; intended timing is not actual timing. |
| Jev evaluation (optional) | ReplyPlan + defined criteria | Decision[] | Select/check bounded options; no free-text generation or exact phoneme timing. |
| TTS adapter | ReplyPlan | SynthesizedAudio | Map supported controls; report unsupported controls instead of silently claiming success. |
| Output alignment (optional capability) | Text and generated audio | ActualAlignment | Provider timing or explicit alignment; unavailable is allowed until a supporting provider is chosen. |
| Storage / memory | Turn records | Relevant history/preferences | Store facts separately from inferred emotions; memory write policy awaits agreement. |
| Round orchestration | One valid submission | Result or structured error | Sequence ports, enforce single in-flight round, bounded retries/timeouts. |

Adapters implement interfaces, while orchestration consumes only domain types. Avoid one universal AI service that mixes ASR, dialogue, TTS, storage and secrets.

## Proposed project layout

```text
D:\voicebot\
  AGENTS.md                       development boundaries
  .env                            owner-managed credentials (ignored)
  .env.example                    shareable configuration template
  voice-system-flow.md             agreed process visualization
  docs/
    decisions.md                  confirmed versus proposed decisions
    architecture.md               this design
    contracts.md                  data and provider contracts
    development-workflow.md       delegation and acceptance
    tasks/                        bounded Qwen task briefs and historical work
    reviews/                      supervisor review findings
  apps/
    server/src/
      api/                        HTTP boundary, request validation
      application/                complete-round use cases
      domain/                     provider-independent contracts
      providers/                  individual cloud adapters
      storage/                    file/history persistence
      config/                     server-side environment loading
    web/src/                      recording, progress, playback
  tests/
    fixtures/                     synthetic/sanitized fixtures only
    acceptance/                   complete-round behavior checks
  tools/harness/                  Codex CLI launcher and provider metadata
  data/                           private media and history (ignored)
  .runtime/                       local coding runs/reports (ignored)
```

Directories under `apps`, `tests`, and `tools` are a proposed layout, not claims that code already exists. Avoid scaffolding empty layers before their first task.

## First deliveries

1. H00-Qwen: verify the Alibaba Qwen-backed Codex CLI harness with a restricted smoke task. DeepSeek has been retired by the owner.
2. M01: implement provider-independent annotation contracts and validation after this design is discussed.
3. M02: audio input + selected analysis provider; inspect actual annotation quality before proceeding.
4. M03: selected dialogue model + persona + basic history.
5. M04: selected TTS + expression mapping + full-response playback.
6. M05: Jev evaluation, richer sound events, output alignment, or longer-term memory as separately agreed additions.

Missing sound-event or emotion support must remain an explicit capability gap. A text-only demo is not acceptance of the emotional voice goal. Provider selection may move relevant M05 capabilities earlier.
