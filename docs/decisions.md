# Decision register

Status meanings: confirmed = agreed with the owner; proposed = awaiting discussion; verified-docs = documented by a vendor but not yet runtime-tested.

| ID | Topic | Status | Decision / open item |
|---|---|---|---|
| D01 | Interaction | confirmed | Manually start/stop recording; submit a complete clip; process and play a complete response before the next round. |
| D02 | Deployment | confirmed | Cloud APIs first, to build the initial complete flow quickly. |
| D03 | Development roles | confirmed | Codex supervises architecture and acceptance; Qwen3.8-Flash implements through Codex CLI. Owner subsequently authorized official DeepSeek fallback when Qwen fails: “qwen不行就deepseek”. Every implementation remains subject to independent acceptance. |
| D04 | Credentials | confirmed | Owner places credentials in root `.env`; launcher reads them without exposing values. |
| D05 | Coding provider | confirmed | Primary: Alibaba Cloud Model Studio qwen3.8-flash, using existing balance. Official api.deepseek.com deepseek-flash is authorized fallback after connection failures. Launchers isolate the selected coding credential; DASHSCOPE_API_KEY and DEEPSEEK_API_KEY never substitute for each other. Runtime dialogue provider remains a separate choice. |
| D06 | CLI compatibility | verified-runtime | Codex CLI 0.159.2 with official deepseek-flash completed H00 read/edit/read-back. Native elevated sandbox setup failed locally; the documented unelevated workspace sandbox succeeded. Approval escalation remains disabled inside coding runs. |
| D07 | UI and stack | confirmed | Owner accepted TypeScript, browser UI and local Node backend, then requested NestJS. Domain contracts stay framework-independent; NestJS belongs in transport/application wiring. |
| D08 | Input speech provider | confirmed | qwen3-asr-flash-filetrans via asynchronous REST, enable_words=true. Preserve provider text-unit intervals and sentence emotions. Prosody/sound events remain unsupported until separately selected. |
| D09 | Dialogue provider | proposed | Not selected. Do not assume the coding DeepSeek key also selects or authorizes a runtime dialogue model. |
| D10 | TTS | proposed | Choose model, voice, emotion controls, and supported audio format together before implementation. |
| D11 | Jev | proposed | Keep an optional evaluation interface. Discuss whether the first usable version enables it or first uses the dialogue model's expression plan. |
| D12 | Memory | proposed | Begin with persona file, recent-turn history, and explicit preferences. Semantic retrieval/automatic long-term memory requires a separate decision. |
| D13 | Clip and request limits | proposed | Initial target: 30 seconds and 10 MiB per input clip; bounded provider timeouts and no unbounded retries. Confirm in task brief. |
| D14 | Git workflow | confirmed | Immediately commit each tracked-file edit separately. Push to https://github.com/pellx/mutsumi after a substantial module passes supervisor acceptance. Never push .env, real audio or runtime logs. Remote was empty at inspection; origin is configured. |
| D15 | Project name | confirmed | Owner finalized the project name as mutsumi, superseding the temporary wakaba name. Package and product documentation use mutsumi. Workspace is D:\\voicebot; designated remote is pellx/mutsumi. |
| D16 | Flash versus Next | verified-docs / selected | Qwen's official model card describes Flash-Next as the open-weight version and Flash as the official hosted version based on it with additional production features. Select hosted Flash for the cloud coding workflow; this is a deployment-fit decision, not a claim of universal benchmark superiority. |
| D17 | Initial text timing | confirmed | Owner requires text timing/duration in the first version (2026-10-01), choosing asynchronous transcription over a synchronous interface without timing. Store supported word/character start/end milliseconds; derive duration. Do not fabricate per-character boundaries from phrase durations. |
| D18 | ASR media storage | confirmed | Owner chose Alibaba prototype temporary upload now, later migration to owner-managed OSS. Model-bound temporary storage lasts 48h; use REST with X-DashScope-OssResourceResolve. Local originals remain separate. No live ASR call has run. Storage and transcription use separate ports. |

## Sources checked on 2026-10-01

- Codex custom provider configuration: https://learn.chatgpt.com/docs/config-file/config-advanced
- Codex configuration reference: https://learn.chatgpt.com/docs/config-file/config-reference
- DeepSeek Codex integration: https://api-docs.deepseek.com/quick_start/agent_integrations/codex/
- DeepSeek Responses API: https://api-docs.deepseek.com/api/create-response/
- Qwen model relationship: https://huggingface.co/Qwen/Qwen3.8-Flash-Next
- Qwen Codex metadata / reasoning levels: https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/codex
- Alibaba Responses endpoint/model support: https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses

## Current execution status

- Project originally contains `voice-system-flow.md` only; no business code or Git repository was present at inspection.
- Owner filled root .env; values are not stored in this register.
- Historical DeepSeek H00 passed. Its initial replacement during M01 was superseded by the owner's explicit fallback authorization. Following repeated Qwen connection failures, official DeepSeek implemented the M02 ports, result mapper, temporary publication and analysis transport through the restricted Codex CLI harness.
- H00-Qwen authenticated tool/file smoke passed using qwen3.8-flash through Alibaba with CLI 0.159.2. Coding key is configured locally; its value is never recorded here. Smoke result is ignored .runtime/qwen-smoke/result.json.
- Qwen wrote acceptance tests, repaired four fixture defects, and generated package.json. Source remains historical DeepSeek code reviewed by the supervisor. Supervisor independently ran npm run check: strict TypeScript and all 104 tests passed, 0 failures. M01 input annotation subset is accepted; this does not establish actual audio recognition quality or a running voice app.
- Launcher defaults to xhigh; routine tasks can use per-invocation medium. Default time budget 5 minutes, configurable up to 10; timeout output is inspected for partial edits before any retry. Some Qwen attempts timed out without edits; final repair completed successfully.
- Dependencies are pinned/locked. Runtime ASR/dialogue/TTS and browser/NestJS wiring are not implemented. M01 was pushed to origin/main at 86013db1efa3741f3cf0d54f6acbfa8c040a1508 after history/private-content review; remote commit matched. Later M02 planning documents remain local until the next accepted milestone.
- Qwen CLI repeatedly failed its connection without edits; ignored report .runtime/harness-runs/2026-10-01T02-04-47.144Z/report.json records the original failure. A credential-free endpoint probe returned HTTP401; no proxy variables were set. Root cause remains unresolved; sandbox controls remain enabled. Authorized DeepSeek fallback is working.
- M02 ports and result mapper passed independent strict type checks; domain/mapper tests total 114. Temporary publication passed 35 synthetic test groups and one actual upload of a locally synthesized Chinese WAV (6268ms). Private remote reference is ignored under data/qa. Analysis transport compiles; independent transport tests and actual transcription are pending. NestJS/intake/UI, dialogue and TTS are not implemented.
