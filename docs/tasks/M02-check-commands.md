# M02 — Extend reproducible checks

Implementer: official DeepSeek authorized fallback. Read AGENTS.md and its required architecture/flow documents. Modify ONLY root package.json in ONE write operation. Keep existing metadata, engines, dependency pins and harness:check. No dependencies, lock edits, Git, providers or .env.

Update test script to run both explicit paths: node --test tests/acceptance/annotation.test.mjs tests/acceptance/filetrans-result.test.mjs.

Update typecheck script to use tsc --noEmit --strict --allowImportingTsExtensions --target ES2022 --module NodeNext --moduleResolution NodeNext, checking apps/server/src/domain/annotation.ts, apps/server/src/application/analysis-ports.ts and apps/server/src/providers/aliyun/filetrans-result.ts. Native Node test execution imports .ts; type-only .js imports use NodeNext resolution. Existing check script stays npm run typecheck && npm test.

After writing, parse saved JSON once and report. Supervisor commits and independently runs npm run check. Stop after read-back, no source inspection or additional edits. Proposed commit message and actual changed path required; do not claim integration acceptance.
