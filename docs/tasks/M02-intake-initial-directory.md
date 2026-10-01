# M02 first-run audio intake directory repair

Qwen3.8-Flash primary; official DeepSeek fallback D22. Required AGENTS/flow/architecture/sleep-plan are preloaded completely; read there, do not reopen. Read ONLY apps/server/src/providers/local/native-audio-intake.ts. One write to that file only; no Git/launchers/discovery/secrets/cloud/private data/native execution/extra files. Supervisor commits.

Independent owner-recording ingestion failed before probing because createWorkDirectory tries mkdir(<workRoot>/intake-UUID) while a fresh configured work root does not exist. Fix only startup/cancellation handling:
- createWorkDirectory accepts the caller AbortSignal. Check live, ensure configured work root with mkdir({recursive:true,mode:0700}), check live, then exclusively mkdir the random intake-* child and return its path. Existing work root is retained, not cleaned/deleted.
- ingest calls createWorkDirectory(signal), records the returned path, and checks live immediately before writeFile. If abort arrives as the unique child finishes creation, its path must reach the caller's finally cleanup; do not throw inside the helper AFTER the successful child mkdir but BEFORE returning that path.
- Keep all cleanup containment checks, format/EBML/metadata validation, original bytes, decoded sample timing and storage semantics unchanged. Do not reformat/compact this501-line file.

Use exact-once anchors and one write. Run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json, propagate actual exit, report and stop. Never put a literal NUL character in tool command JSON; if adding NUL checks use String.fromCharCode(0), not ambiguous escaped character literals. Supervisor reruns real MP3/WebM and first-run path tests.
