# M02 — Repair a changed fixture

Official DeepSeek authorized fallback. Read AGENTS.md and required architecture/flow documents. Modify ONLY tests/acceptance/filetrans-result.test.mjs in ONE successful write, no later edits or compaction. No line-count target. No source changes, providers, packages, .env or Git.

Supervisor reviewed your unassigned compaction and found a fixture regression: in malformed structure cases, 'nonempty transcript no sentences': t0([]) passes a bare transcript record, so it fails for missing root transcripts instead of the intended contradictory speech state. Fix it to the proper root wrapper { transcripts: [t0([])] }. Add a fixture sanity assertion that this scenario has exactly one channel-0 transcript with nonempty text and zero sentences before it is passed to failure(). Keep all existing behavior assertions and fixtures. Do not simplify/rewrite any unrelated checks or shrink the file.

Run test once with node --test tests/acceptance/filetrans-result.test.mjs; if spawning is blocked, execute same file in-process once and report infrastructure limitation. Then report and stop. Supervisor commits and performs final independent checks. No source exploration or post-write diagnostics/formatting.
