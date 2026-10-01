# M02 parser acceptance repair — Qwen

Only writable file: apps/server/src/providers/aliyun/filetrans-result.ts. Make ONE surgical patch/write, never rewrite the whole file or re-edit afterward. Supervisor immediately commits. Read required AGENTS.md, voice-system-flow.md, docs/architecture.md and docs/decisions.md; batch context and target reads. No workspace listing, private data/.runtime/.env, APIs, delegation, commits or pushes. Use default sandbox permissions; never request escalation. One targeted check may run in-process (`node tests/acceptance/filetrans-result.test.mjs`); report failures instead of editing again.

Existing 202 tests pass, but supervisor rejected eligibility validation. Reproductions use a valid 1000ms asset, transcript/sentence text 你。, sentence bounds 0–1000ms:

1. words=[{text:'你',begin_time:0,end_time:0,punctuation:{}}], emotion='neutral'. inspectFiletransResult wrongly reports eligible despite malformed punctuation.
2. words=[], emotion={}. It wrongly reports eligible despite malformed emotion.
3. words=[{text:'你',end_time:1.5}], emotion='neutral'. It wrongly reports eligible because missing start masks invalid end.

Repair the shared scan so it validates independent fields even when timing is missing/equal. Read/check word punctuation regardless of the timing defect; read/check sentence emotion even if words are absent/null/empty. Independently classify both time fields: malformed type/fraction and any present boundary outside sentence/clip is hard even when the other is missing. Reversed positive bounds are hard; only both otherwise valid equal bounds, or genuinely missing bounds, are eligible. Inspect the entire otherwise reachable payload; hard issues take precedence for eligibility. Native mapFiletransResult without calibration still uses its first defect's existing safe code; preserve all existing tests.

Prepare honest parsed data for the next fusion step without fabricating times: keep every structurally valid sentence (text, original bounds, emotion) even with no words; keep structurally valid word text/granularity even when a bound is missing/equal. ParsedUnit may use number|null bounds (null is missing, not guessed). A defect-free native build must guard/narrow non-null positive bounds. Never emit an incomplete annotation; the public strict mapper still fails. No third calibration argument/fusion in this task.

Paraformer maps supported positive timing, with unavailable emotion. Unexpected Paraformer emotion content need not become observations; do not loosen Qwen field validation to do this. Keep parser limits, safe failures, no mutation/accessor execution.

Prefer targeted replace/patch, not an entire 500-line output. Report actual modified file, checks and a matching one-file commit suggestion.
