# M02 Qwen Audio publication allowlist

Confirmed D27: owner selected runtime qwen-audio-3.1-asr-flash-filetrans for reference-conditioned timing. Coding implementer gpt-6-luna.

Target only apps/server/src/providers/aliyun/temporary-publication.ts. Read this file and, if needed, apps/server/src/application/analysis-ports.ts. No other source discovery or credential scripts.

Make exactly one physical write: add the exact model qwen-audio-3.1-asr-flash-filetrans to the existing publish model allowlist while preserving qwen3-asr-flash-filetrans and paraformer-v2. Define a local named constant (do not edit mapper or interfaces), update any directly affected explanatory model comment. Preserve every upload policy, URL/host, size, credential, cancellation, expiry and model-binding check. No arbitrary model support, API calls, fallback or new provider adapter here.

Read-only validation after the one write: node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json. Report exact target, check outcome and a suggested concise commit message. Stop; supervisor commits before further edits.
