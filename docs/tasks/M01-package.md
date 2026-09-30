# M01 — Reproducible local checks

Read AGENTS.md and its required architecture/flow documents. Create ONLY root package.json in exactly one write operation, then stop. Do not install dependencies, modify other files, read .env, invoke providers, or write Git. Supervisor will commit and install afterward.

Project name mutsumi. Private package, type module, Node engine >=24. Minimal devDependency typescript pinned exactly 7.0.2. No runtime dependencies or NestJS scaffolding yet: the accepted domain module is framework-independent and runtime provider choices remain pending.

Provide scripts:
- test: node --test tests/acceptance/annotation.test.mjs
- typecheck: tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext apps/server/src/domain/annotation.ts
- check: npm run typecheck && npm test
- harness:check: node tools/harness/run-qwen.mjs --check

Use a concise description of the emotional voice assistant. Parse the saved JSON using Node to check syntax once; no repeated exploration. Report changed path, actual syntax-check outcome, limitations, and proposed commit message. No source code or application build exists beyond the domain module; do not claim a runnable voice service.
