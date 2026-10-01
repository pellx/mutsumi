# M01 supervisor acceptance — 2026-10-01

Accepted scope: provider-independent input audio annotation types, validation, parsing and serialization; public module apps/server/src/domain/annotation.ts. This is not acceptance of live ASR, audio quality, HTTP, NestJS or UI.

Source originated from the retired DeepSeek implementation and subsequent constrained fixes. Current Qwen implementer wrote/repaired synthetic acceptance tests and package configuration. Supervisor owns this review and independently ran npm run check: strict TypeScript 7.0.2 succeeded; node:test reported 104 tests, 104 passed, zero failures/skips. Dependencies are pinned in package-lock.json, installation used npm install --ignore-scripts.

Review established explicit unavailable timing, provenance, capability gaps, score semantics without normalization, reference uniqueness, parent interval containment, overlap/gap support, silent transcription, immutable input, invalid JSON and serializer errors. Test fixtures were corrected rather than changing valid source behavior: distinct unavailable reasons, explicit non-enumerable descriptors, explicit undefined asset handling, Chinese sample text and genuinely asset-valid out-of-parent intervals. Getter counters remain zero through validation and failed serialization.

Limitations: container checks are for ordinary JSON-oriented data, not arbitrary JavaScript Proxy traps. Metadata validation does not inspect audio bytes. Provider timestamps are estimates with provenance, not physical truth. Some diagnostic assertions use specific wording and may need updating for an intentional message change. Duration is derived from measured start/end rather than separately stored. Phrase emotion is not per-character independent emotion.

A push review checked all 42 then-existing commits for exact configured credential values and secret-like token patterns without printing values, and checked private paths were absent from tracked content/history. .env, data and .runtime ignore checks passed. Initial M01 push to origin/main completed at 86013db1efa3741f3cf0d54f6acbfa8c040a1508; remote HEAD matched. This review file is a later local record and is not yet part of that push.

Remaining stages: approved asynchronous text-timed ASR with temporary publication; local audio intake; actual sample transcription and granularity review; NestJS/browser wiring; separately selected dialogue and TTS. M02 is not accepted merely because its port declarations compile.
