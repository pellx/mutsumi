# M02c — Fix two independently reproduced failures

Official DeepSeek authorized fallback. Read AGENTS.md and required architecture/flow; modify ONLY apps/server/src/providers/aliyun/temporary-publication.ts in ONE successful write. No subsequent edits or compaction. No tests/source elsewhere, packages, credentials, network or Git. Read relevant #verifyAudio/#requestPolicy methods and tests for these two scenarios; no repeated full-module exploration. Saved-file read-back only; supervisor commits and reruns tests.

35 independent synthetic tests currently have 33 passes, 2 failures. Keep all existing correct behavior:

1. In #verifyAudio, Blob size must be <= this.#maxBytes before requesting the upload policy. Config maxBytes=1 and a 4-byte Blob currently proceeds to policy GET then fails at later effective policy comparison. Add the missing local-size gate with invalid_audio, before any network; retain the later policy/config Math.min comparison.
2. In #requestPolicy, if #readNow throws after the HTTP200 policy response but before readBoundedJson, the response body remains unread and uncancelled. Wrap arrival-clock/read/parse handling so ANY error releases the policy body best-effort without awaiting potentially hanging cancellation, then rethrows the original safe failure. Existing streaming cleanup must continue working. Do not let cleanup errors mask the failure or leak provider/key values.

Do not modify tests to pass, alter public options, or introduce unrelated wrappers. These are source defects, not fixture defects. Report actual file and changes; no unrun-check claims. Stop after one read-back.
