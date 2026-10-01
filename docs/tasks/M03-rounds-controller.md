# M03 NestJS round HTTP controller
Create ONLY apps/server/src/api/rounds.controller.ts, one successful write, no Git/other edits. Qwen primary; D22 official DeepSeek fallback on bounded failure. Read ONLY application/runtime.ts, round-service.ts PUBLIC export signatures/submit/getJob/getTurn/markPlaybackCompleted (not whole validator internals), conversation-ports.ts and domain/conversation.ts. Required context already supplied. No .env/data/harness/provider calls.

Use NestJS decorators, type-only Express Request/Response imports, import values from '../application/...', types '../domain/...'. Export @Controller('api') class RoundsController; constructor @Inject(RUNTIME_TOKEN) runtime:Runtime (avoid TS parameter properties if unnecessary). Thin transport around approved ports; no vendor SDK/raw responses.

Routes:
GET health -> cloned runtime.health.
POST sessions (201) -> {session_id:runtime.sessionId,mode:runtime.mode}; body must be empty object or absent, no arbitrary session creation.
POST sessions/:sessionId/turns (202) -> runtime.rounds.submit({session_id:sessionId,client_request_id,submission:{bytes:file.buffer,declared_media_type:file.mimetype}}). FileInterceptor('audio') in-memory default, limits fileSize10485760,files1,fields1,fieldSize128,parts2. Require Buffer nonempty <=10MiB, exact body only client_request_id nonempty string; reject extra fields and filename use. Session must exactly runtime.sessionId before service. No cloud retry.
GET jobs/:jobId -> matching runtime mode/session job or owned not_found.
GET sessions/:sessionId/turns/:turnId -> service getTurn, safe not_found.
POST sessions/:sessionId/turns/:turnId/playback-completed -> service markPlaybackCompleted; require empty body. Actual browser ended sends this, server doesn't auto-mark.
GET jobs/:jobId/audio/:assetId -> match canonical UUID asset against terminal job.record source_asset/input_asset/output_asset ONLY, then audioStorage.readById. No arbitrary asset/key/path access.
GET sessions/:sessionId/turns/:turnId/audio/:assetId -> same exact record-linked access for persisted record. Never serve other mode/session.
Media sends actual stored MIME, Accept-Ranges:bytes, nosniff/no-store; full200 or ONE bounded bytes=start-end/bytes=start-/bytes=-suffix Range206, Content-Range/Length. Invalid/reversed/out-of-bounds/multi-range =>416 with bytes */length, static safe JSON. HEAD sends same headers no body. Native Uint8Array -> Buffer respecting byteOffset/byteLength. Asset metadata must match linked record's asset; corruption -> invalid_result.

All async storage/read/playback calls at HTTP boundary bounded to2s with timer cleanup and observation of abandoned rejection; no retry; timeout doesn't prove no write. Round processing remains asynchronous/polled and shared120s service deadline.
Use makeRoundError/toRoundFailure; foreign errors become static provider_failed, never echo exception/URL/path/filename/key/request content. Controllers can throw ONLY owned RoundError; a global main filter later maps status {invalid_input400,busy409,not_found404,provider_unavailable503,cancelled408,timed_out504,provider_failed502,invalid_result502,storage_failed500}. Default stage intake; preserve appropriate store/synthesis stages by mapping in controller if useful, but no fabricated provider errors. Do not throw plain RoundFailure objects: factory branded errors needed. Multer framework errors sanitized by main filter. Don't add cross-origin middleware here: bootstrap installs before parser/Multer.

Prefer concise <=350lines. Create parent via [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetPath)); PowerShell Split-Path -LiteralPath -Parent is invalid. No literal NUL. One write then npm run typecheck and stop. Supervisor independently checks multipart, IDs, linked asset access, single-range seeking, timeout/error redaction and full local owner-human mock flow; no actual cloud acceptance claimed.

