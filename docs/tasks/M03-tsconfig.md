# M03 strict server build configuration

Implementer: Qwen3.8-Flash; official DeepSeek fallback is authorized by D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and package.json. Only create root tsconfig.json in ONE write. No Git mutations, private files, recursive discovery, install, cloud calls or other file writes. Never invoke a harness/credential loader. Supervisor commits immediately and performs the emitted build.

Use this exact compiler architecture (JSON, two-space formatting, trailing newline): compilerOptions.target='ES2022', module='NodeNext', moduleResolution='NodeNext', rootDir='apps/server/src', outDir='dist/server', strict=true, experimentalDecorators=true, emitDecoratorMetadata=true, esModuleInterop=true, forceConsistentCasingInFileNames=true, verbatimModuleSyntax=true, allowImportingTsExtensions=true, rewriteRelativeImportExtensions=true, skipLibCheck=true, lib=['ES2022','DOM','DOM.Iterable'], types=['node']. include=['apps/server/src/**/*.ts']; exclude=['node_modules','dist','data','.runtime']. Do not introduce paths aliases or frontend build dependencies.

Value .ts imports used by the accepted Node type-stripping tests must be rewritten to .js for the emitted ESM NestJS server. NestJS decorators are compiled by tsc, never executed through native Node type stripping. Existing standalone domain tests still import source .ts directly. dist/ is already ignored. skipLibCheck only applies to dependency declarations; application code remains strict.

Write once, read back/parse JSON and run `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` only (no build artifacts in the coding invocation). Report actual result and any diagnostics without another edit, plus exact file and commit suggestion.
