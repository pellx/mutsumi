# M02 preserve safe storage IO error boundary

Qwen3.8-Flash; official DeepSeek fallback D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and ONLY apps/server/src/storage/file-audio-storage.ts. One write to that file only, no Git/launchers/discovery/secrets/cloud/other edits. Supervisor commits.

The last repair passes 18 independent storage checks and strict tsc, but removed the catches around handle.stat/read and readByKey. Raw native IO exceptions can now escape the public port, and an abort concurrent with IO rejection loses the owned cancelled code. Fix only the public read methods:
- readById: keep invalid UUID ->null; wrap await this.readAssetSafely(assetId) in try/catch, converting ANY caught rejection to this.failed() (never borrow foreign properties/messages). Null results remain null.
- readByKey: keep existing abort and invalid UUID prechecks; await the private resolver inside try/catch, catching to this.cancelled() if signal.aborted, otherwise this.failed(). After successful await retain the abort check, null ->owned not_found, and independent Uint8Array Blob copy. Avoid double-wrapping not_found by throwing it outside this resolver catch.

Do not change successful storage/cleanup/read-loop behavior or reformat the file. Make exact-once anchor assertions and write once. Run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json and stop, reporting the real exit. Supervisor independently injects partial reads, growth and IO errors in ignored QA scripts.
