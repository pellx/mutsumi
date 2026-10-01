# M02 Qwen Audio timing type repair only

Target ONLY apps/server/src/providers/aliyun/qwen-audio-timing.ts. Application draft committed3eb3192. Implementer gpt-6-luna. Exactly one target write, supervisor commits. This narrow task supersedes the prior oversized repair for this invocation; functional repairs follow separately.

Read ONLY the target (Get-Content -Raw) and application/input-stage-ports.ts (71lines), not the huge domain/mapper dependency files. Combined output should not be truncated; if a read is truncated, read the remaining exact target lines instead of abandoning the task. Do not run providers or read private files/credentials. No extra writes.

Only two changes:
1. In first import, remove TimingPort and UntimedTranscription from analysis-ports.js; add a separate import type of those two from ../../application/input-stage-ports.js. This also restores types for Array.from(reference.transcript), sound_events.map callbacks.
2. After taskRoot/output/task variables are declared in align, explicitly check that output is nonnull and throw the same safe submission_failed error otherwise, so getResult(output) receives Record<string,unknown>.

Prepare anchored modifications in memory using exact literal source, verify import and null guard once, write one time. After write run node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json once. Report actual errors or success and stop. Do NOT use inability to see unrelated files as a reason to stop; this task needs only these two small, known import/narrowing fixes.
