# M03 output-alignment provenance repair

Qwen3.8-Flash; official DeepSeek fallback under D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and ONLY apps/server/src/domain/conversation-validation.ts. Modify that file in ONE write, no other writes, Git, launchers, secrets, discovery or cloud calls. Supervisor commits. Focus on the named constant and checkGeneratedSpeechAlignment; do not reread unrelated sources.

Independent supervisor checks passed 45 contract cases but review found two provenance defects. Correct only these:
- PLANNED_TIME_SOURCE_PATTERN currently rejects every substring /plan|estimat|intend|schedul/i. Actual output forced alignment can legitimately be estimated AFTER audio exists; estimation alone is allowed. Reject explicit planned/intended/scheduled provenance as delimiter-separated tokens (start/end or slash, colon, underscore, whitespace, hyphen), not substrings in provider names or words such as explain. Suggested token expression /(?:^|[\/:_\s-])(?:plan(?:ned)?|intended|schedule(?:d)?)(?:$|[\/:_\s-])/i. Do not reject forced-alignment-estimate, explain-provider or provider-measured. Change the issue text to planned timing, not estimated timing.
- Apply the same explicit planned-time rejection to EACH unit timing.source after its existing bounded string check, not only alignment.source. Keep all source values unchanged when valid.

Build replacements and exact-once anchor assertions in memory before writing once. Do not reformat or compact this 819-line file. Run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json only; report actual file/check and commit suggestion. Supervisor runs independent behavior checks.
