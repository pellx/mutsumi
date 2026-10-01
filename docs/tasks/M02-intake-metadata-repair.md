# M02 strict reported numeric metadata

Qwen3.8-Flash; official DeepSeek fallback D22. Required context documents are preloaded fully; read there without reopening. Read ONLY the readSeconds/readCount region of apps/server/src/providers/local/native-audio-intake.ts (around lines186..236), using scoped rg anchors if needed. One write to that file only, no Git/launchers/discovery/secrets/cloud/private data/native tools/other files. Supervisor commits.

Thirteen genuine recording/format/boundary cases passed. Six additional mocked ffprobe cases caught that malformed present numeric fields null/empty are silently accepted as missing. In BOTH readSeconds and readCount:
- Only undefined (field absent) or a string N/A (case-insensitive, existing trimming retained) returns null for unavailable information.
- A present null or empty/whitespace-only string is invalid(), not unavailable.
- Preserve all existing number/string parsing, positivity, finite/safe-integer checks and limits. N/A remains explicitly unknown; do not invent metadata.

Precisely replace the shared undefined-or-null early guard and empty-or-N/A early guard (each anchor has TWO occurrences, assert that expected count before replacement). No other changes or formatting. Build in memory, write once, run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json with real exit, report and stop. Supervisor reruns both actual recording ingestion and mocked numeric-field boundaries.
