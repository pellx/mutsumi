# M03 finish observation context budget

Qwen3.8-Flash; DeepSeek fallback D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and ONLY apps/server/src/application/dialogue-context.ts. One write to that file only, no Git/launchers/discovery/secrets/cloud/other edits. Supervisor commits. Existing 10 independent context cases passed; preserve all behavior except these additional bounds.

The current count/string limits omit nested provenance fields. Extend isOverlong to skip an observation when any segment_ids entry is longer than128 or timing.source (available) / timing.reason (unavailable) is longer than256. Preserve originals; skipping sets truncated as before. Also cap the total serialized kept observations to16384 UTF-16 code units: sum JSON.stringify(obs).length over admitted records, exclude a record that would exceed the budget, set truncated=true, and continue considering remaining existing candidates. Validation already rejects getters/accessors; no need to read validator internals. Keep first32 candidate semantics, score meanings, references and provenance unchanged. Empty observation array is valid. No inference or retiming.

Make exact-once replacement assertions before one write, do not reformat. Run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json and stop. Report actual file/check and short commit suggestion.
