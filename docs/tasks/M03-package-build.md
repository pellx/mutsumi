# M03 NestJS package configuration

Implementer: Qwen3.8-Flash; official DeepSeek fallback is approved under D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and root package.json. Only modify package.json in ONE write. Do not inspect credentials/private files, discover configuration, install packages, run providers, generate lockfiles, mutate Git or edit any source. Supervisor installs and immediately commits the lockfile separately.

Keep name/version/private/type/description/engines and TypeScript 7.0.2. Add exact pinned runtime dependencies: @nestjs/common 12.1.2, @nestjs/core 12.1.2, @nestjs/platform-express 12.1.2, reflect-metadata 0.2.2, rxjs 7.8.2. Add exact dev dependencies @types/node 26.6.3, @types/express 5.0.6 and @types/multer 2.3.0. Versions were read from the official npm registry by the supervisor; no lookup is needed. No Nest CLI, telemetry, ORM, vendor SDK, websocket or realtime dependencies.

Scripts (preserve harness:check):
- test: node --test tests/acceptance/*.test.mjs
- typecheck: tsc --noEmit -p tsconfig.json
- build: tsc -p tsconfig.json
- check: npm run build && npm test
- start: node tools/run-server.mjs
- start:mock: node tools/run-server.mjs --mode=development-mock

The assigned tsconfig and server launcher are subsequent separate files; do not claim build/start currently works. Build is strict TypeScript and test uses the existing suites plus future committed suites. dist/ is already ignored.

Before writing, parse the existing JSON, construct the full proposed object and verify unrelated metadata is unchanged and all dependencies/scripts match. Write once with two-space formatting and a trailing newline. Read back/parse JSON and report exact changes, checks, limitations and a commit suggestion. No temporary files or npm commands in this task.
