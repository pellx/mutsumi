# D22 implementation plan and boundaries

Owner authorized continued development while sleeping on 2026-10-01. Qwen3.8-Flash is the primary Codex CLI implementer; one failed bounded invocation may fall back to official DeepSeek after the supervisor checks for partial edits. Every individual tracked-file write is immediately reviewed and committed separately. No push until owner inspection. This plan extends scope under D22; it does not declare delivery or waive acceptance.

## Runtime providers and acceptance

Input analysis selects official gemini-3.8-flash under D21. The Google metadata preflight reached the official endpoint through the owner's existing enabled local proxy but returned HTTP403 API_KEY_SERVICE_BLOCKED for generativelanguage.googleapis.com. No Gemini generation/audio request has run. Owner now requires free quota only; do not enable billing, purchase credits or silently use paid calls. Defer live Gemini acceptance while configuration is unresolved. The pure mapper has passed 32 independent synthetic JSON boundary cases and strict TypeScript; this proves structure only.

Dialogue and TTS models remain unselected. Implement their ports, domain validation, orchestration and explicit unavailable-provider behavior, without silently reusing a coding credential or selecting a commercial model. Jev remains optional and disabled. Long-term semantic memory and autonomous fact extraction remain deferred; implement recent-turn history, a persona configuration and explicit owner-authored preferences only.

## Delivery order

1. Provider-independent conversation contracts, bounded context building and expression-plan validation.
2. Node/NestJS build configuration and pinned dependencies, preserving all existing acceptance suites.
3. Private filesystem storage and actual format/duration inspection, retaining originals and creating normalized analysis audio through the installed ffprobe/ffmpeg executables.
4. Complete-round orchestration, safe stage outcomes and local history. Analysis may complete while dialogue or synthesis is explicitly unavailable; retain useful partial results without claiming a full voice response.
5. NestJS local HTTP API and static browser client: manual start/stop recording or choose an audio file, submit once, display all word/subword units with times and candidate emotion references, play original audio and available real reply audio.
6. Explicit development-only provider mocks for offline checks. They never establish real recognition/emotion/voice quality and must be labelled in API responses and UI.
7. Offline Gemini transport implementation if useful for composition, with one stateless inline request, bounded cancellation, no automatic retry and explicit model-estimate provenance. Actual free-tier live run stays deferred until the owner resolves configuration.

## Paths and composition

- Domain contracts: apps/server/src/domain/conversation.ts; existing annotation.ts remains authoritative for input annotation.
- Application context/expression helpers and round service: separate files under apps/server/src/application/.
- Storage and audio intake: apps/server/src/storage/ and apps/server/src/application/; use configured project-root-relative data paths, opaque generated IDs and authorized server-side resolvers.
- NestJS module, controllers and bootstrap: apps/server/src/api/ and main.ts. No vendor payloads in controllers or domain objects.
- Browser: apps/web/public/index.html, app.js and styles.css. No cloud keys, absolute paths or raw provider responses.
- Supervisor launchers under tools/ may load only explicitly allowlisted runtime settings from .env as data and pass configuration to the server. Never load coding-provider credentials into runtime providers.
- Private originals, normalized files, conversation records and QA evidence remain ignored under data/. Coding reports and supervisor acceptance scripts remain ignored under .runtime/.

## Contract choices

Times remain integer clip-relative milliseconds. Google-generated bounds are labelled model estimates; planned synthesis timing never becomes actual audio timing. Readable word/subword display units are not provider-private vocabulary IDs. Candidate emotion remains at segment scope; units link to that observation rather than acquiring invented independent scores. Missing capabilities are unavailable.

Persona instructions, explicit preferences and bounded history are separate from quoted/untrusted user speech. Context building caps turns and text length and includes whether previous assistant audio was played; it does not turn inferred emotions into stored facts. Reply drafts/plans carry text plus optional intended tone/intensity/pace/pause, independent of any TTS vendor. Generated audio and actual output alignment are separately validated references.

Backend defaults to loopback, one active complete round, no automatic speech endpointing, interruption controller, WebSocket audio or hidden cloud retries. Upload and analysis budgets are 10 MiB/30 seconds per clip and bounded operation deadlines. Browser MIME is insufficient: inspect actual media and decode an analysis WAV without changing speed or trimming content. Invoke tools with argument arrays, bounded output and cancellation, never a string-built shell command.

Use a client request ID to avoid duplicate submissions within a running server and reject a reused ID with different input. Persist records needed for honest status/history; never claim an ambiguous failed request was free or unsent. No recursive retry on provider errors. API errors expose safe static descriptions, not foreign exception text, signed URLs or paths.

Development mode is opt-in and visible. Synthetic JSON/port fixtures may test structure; never create synthesized human speech as input material. Browser/manual input acceptance uses the owner's existing real recording locally without sending it to coding models. Unselected providers return explicit unavailable status in live mode. No full emotional-voice acceptance until genuine providers and owner listening checks pass.

## Independent checks

Run strict build/type checks and existing 230 acceptance cases after relevant changes, plus new meaningful conversation/orchestration/storage/intake/API cases. Inspect browser behavior at desktop/mobile widths, word selection and original playback, busy/error recovery and visibility of development mode. Live cloud verification is separately reported and only runs within free-quota authorization. Record commands, outcomes, actual implementers and material limitations in docs/reviews/ before final delivery.

Versions checked from the official npm registry: NestJS core/common/platform-express 12.1.2, reflect-metadata 0.2.2, rxjs 7.8.2, @types/node 26.6.3. Existing Node 25.9.0 runs the application; no global Nest CLI generation or telemetry integration is needed. Documentation: https://docs.nestjs.com/first-steps and https://docs.nestjs.com/techniques/file-upload.
