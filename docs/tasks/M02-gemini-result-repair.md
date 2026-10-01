# M02/D21 result boundary repair

Implementer: Qwen3.8-Flash; D22 now authorizes official DeepSeek if Qwen fails. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, D21/D22 and this brief. Only modify apps/server/src/providers/google/gemini-audio-result.ts in ONE successful write. No other files, Git mutations, .env/data/.runtime reads or provider calls. Do not reread unrelated mapper implementations or the entire domain validator; this is a targeted repair of reviewed code.

Independent acceptance found: omitted start_ms currently returns invalid_result rather than timing_unavailable, and an empty emotion string silently becomes null. Code review also found a code-unit count where the brief required a byte count. Repair these boundaries without weakening successful lexical/timing checks:

1. Before JSON.parse, keep the existing fast character limit and additionally reject TextEncoder UTF-8 byteLength >1048576. No Node dependency or new export.
2. For unit objects only, permit omission of start_ms/end_ms as unavailable timing. Still reject every unknown field and require text/granularity. Missing/undefined or null timing cells become unavailable; malformed strings remain invalid. Schema remains unchanged with all fields required, because strict output and tolerant failure classification are separate.
3. Check each present numeric boundary for 0..duration BEFORE returning unavailable for its missing counterpart; negative/out-of-clip values must remain invalid_result. Positive equal bounds return timing_unavailable, reversed bounds invalid_result.
4. If emotion is a string require a nonempty trimmed value, with the existing length limit; reject empty/whitespace-only strings. Preserve the original nonempty string and keep null as unknown.

Build proposed content in memory, assert anchors match once and all changes exist, then write once. Run a short inline check for missing start, null plus negative end, empty emotion, and the unchanged valid fixture. Do not create test files. Report exact changes/checks and a commit suggestion; the supervisor reruns independent acceptance.
