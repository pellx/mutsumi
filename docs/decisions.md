# Decision register

Status meanings: confirmed = agreed with the owner; proposed = awaiting discussion; verified-docs = documented by a vendor but not yet runtime-tested.

| ID | Topic | Status | Decision / open item |
|---|---|---|---|
| D01 | Interaction | confirmed | Manually start/stop recording; submit a complete clip; process and play a complete response before the next round. |
| D02 | Deployment | confirmed | Cloud APIs first, to build the initial complete flow quickly. |
| D03 | Development roles | confirmed | Codex supervises architecture and acceptance; DeepSeek writes business code via Codex CLI. |
| D04 | Credentials | confirmed | Owner places credentials in root `.env`; launcher reads them without exposing values. |
| D05 | Coding provider | confirmed | Owner selected official DeepSeek API, base URL `https://api.deepseek.com`, and supplied `deepseek-flash` in .env. Coding model is separate from application dialogue model. |
| D06 | CLI compatibility | verified-docs | Local Codex CLI 0.159.2 is installed. Current DeepSeek docs describe native Responses API and Codex integration. No authenticated run yet. CLI help also emits a home-directory warning; resolve it before declaring the harness operational. |
| D07 | UI and stack | confirmed | Owner accepted TypeScript, browser UI and local Node backend, then requested NestJS. Domain contracts stay framework-independent; NestJS belongs in transport/application wiring. |
| D08 | Input speech provider | proposed | Select ASR, timing, emotion, and sound-event capabilities individually. One provider is allowed to implement several ports if its API actually supports them. |
| D09 | Dialogue provider | proposed | Not selected. Do not assume the coding DeepSeek key also selects or authorizes a runtime dialogue model. |
| D10 | TTS | proposed | Choose model, voice, emotion controls, and supported audio format together before implementation. |
| D11 | Jev | proposed | Keep an optional evaluation interface. Discuss whether the first usable version enables it or first uses the dialogue model's expression plan. |
| D12 | Memory | proposed | Begin with persona file, recent-turn history, and explicit preferences. Semantic retrieval/automatic long-term memory requires a separate decision. |
| D13 | Clip and request limits | proposed | Initial target: 30 seconds and 10 MiB per input clip; bounded provider timeouts and no unbounded retries. Confirm in task brief. |
| D14 | Git workflow | confirmed | Immediately commit each tracked-file edit separately. Push to https://github.com/pellx/mutsumi after a substantial module passes supervisor acceptance. Never push .env, real audio or runtime logs. Remote was empty at inspection; origin is configured. |

## Sources checked on 2026-10-01

- Codex custom provider configuration: https://learn.chatgpt.com/docs/config-file/config-advanced
- Codex configuration reference: https://learn.chatgpt.com/docs/config-file/config-reference
- DeepSeek Codex integration: https://api-docs.deepseek.com/quick_start/agent_integrations/codex/
- DeepSeek Responses API: https://api-docs.deepseek.com/api/create-response/

## Current execution status

- Project originally contains `voice-system-flow.md` only; no business code or Git repository was present at inspection.
- Owner filled root .env; values are not stored in this register.
- H00 authenticated model/tool loop works, but first file-edit attempt failed because the child CLI defaulted to read-only without a native Windows sandbox selection. A workspace-write retry with the elevated Windows sandbox is underway. No business module is accepted yet.
