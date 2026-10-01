# M03 port documentation correction

Qwen3.8-Flash implements; D22 permits official DeepSeek fallback. Required context: AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and apps/server/src/application/conversation-ports.ts only. Modify ONLY the last named file in ONE write. Supervisor commits; no Git, harness/launcher invocation, .env/data/.runtime, cloud calls, package/config discovery or other edits.

Correct documentation only, preserving every import/export/type/member byte-for-byte:

- In the header and IntakeResult comments, normalized analysis audio IS derived from the original source by decoding/resampling without speed change or intentional trimming. Original and normalized analysis are separately retained, with distinct IDs and the same clip-relative time origin. Remove claims that neither is derived/reconstructed from the other.
- StoredAssetRead is an internal byte-bearing bundle and must never be serialized wholesale into public TurnRecord, prompts or arbitrary responses. An authorized media endpoint MAY serve the asset's bytes and safe public metadata by asset ID, without exposing storage_key or filesystem paths. Remove the current claim that the bytes/metadata can never be returned to the browser, since it contradicts required playback.

Build replacements in memory with exact-once anchors, write once and read back the changed comments. No behavioral tests are needed for a comment-only correction. Report the file and a short commit suggestion.
