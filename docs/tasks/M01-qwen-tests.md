# M01 — Qwen annotation acceptance tests

Status: released after H00-Qwen passed on 2026-10-01. Project: mutsumi. Qwen reviews the existing implementation through observable behavior; supervisor independently accepts the module. Prior code provenance is DeepSeek, not Qwen. The supervisor API client has an authenticated coding key; do not claim it is missing or inspect it. Runtime speech-provider credentials are a separate pending decision.

Read AGENTS.md, docs/contracts.md, docs/tasks/M01-annotation-contracts.md and apps/server/src/domain/annotation.ts BEFORE editing. Create ONLY tests/acceptance/annotation.test.mjs, in exactly ONE file-write operation (use a patch tool if exposed; otherwise one exec write), then run `node --test tests/acceptance/annotation.test.mjs` and report results. Supervisor immediately commits the file. Do not edit source/specs/config or install dependencies. If tests expose defects, report exact inputs, observed/expected behavior and source paths for a separate single-file fix task. Report evidence from tools; do not invent environment state. Do not write plans for validation into fixtures or claim planned checks have passed.

Use node:test and node:assert/strict, importing the TypeScript module by relative path under Node 25 type stripping. Embed synthetic fixtures and helpers in this one test file; no real audio or credentials. Test public functions and schema behavior, not private helpers or line-count/implementation snapshots.

Required cases (grouped tests and parameterized cases are welcome):

- Valid Chinese transcript with measured segment and unit times, phrase emotion and overlapping laughter round-trips without mutation or score changes; null-prototype own-property record and frozen data are supported.
- No word-timing support is explicit unavailable with reason; no fabricated zero timestamps. Unknown emotion without a score remains unknown. Empty detected events with ok differs from unavailable and failed detectors. Silent transcript with empty arrays is valid.
- Negative, reversed, equal, fractional, unsafe and beyond-duration times fail at useful paths. Unit intervals outside a measured parent segment fail; non-contiguous valid units and overlapping observations are allowed.
- Missing/mismatched asset, invalid metadata, missing required fields, malformed containers/null, duplicate segment/observation IDs, and references to absent segments fail safely.
- Probability/confidence must lie within [0,1]; finite ordinal/uncalibrated scores outside that range are preserved. NaN and Infinity fail; scores are not normalized and no exclusive distribution is assumed.
- Observation requires its matching detector status ok; measured units require word_timing ok. Invalid enum values and unknown keys at every schema level fail. Unavailable timing carrying time fields and available timing with null boundaries fail.
- Sparse arrays in segments/observations/units/segment_ids, extra own array keys, custom inherited-field records, symbols and non-enumerable record keys fail. Getter counters remain zero for record fields and indexed array elements, including nested units. Ordinary valid JSON remains supported.
- Invalid JSON and runtime non-string parser input return issues rather than throwing. Invalid serializer input throws a field-path error; valid serialization preserves the full known schema.

Return exact test command, pass/fail totals, changed path, limitations and a proposed commit message. Do not claim acceptance or change the expected behavior to match a discovered source bug.
