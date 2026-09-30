# M01 — Repair acceptance test fixtures

Project: mutsumi. Implementer: Qwen3.8-Flash through the authenticated Alibaba Cloud Codex harness. The supervisor owns commits and acceptance. Read AGENTS.md, this brief, and tests/acceptance/annotation.test.mjs. This is a narrowly scoped test repair; no implementation exploration is needed.

Modify ONLY tests/acceptance/annotation.test.mjs in exactly ONE write operation. Prepare all edits before writing. Do not modify source, other files, credentials, or Git. Do not install dependencies. After the write run `node --test tests/acceptance/annotation.test.mjs` ONCE, then stop and report actual totals and a proposed commit message. No diagnostic command loops afterward. The existing source passes strict type checking; these four observed failures are test setup defects, not evidence of a source bug.

Required repairs:

1. The supposedly Chinese fixture is Japanese. Replace transcript/segment/unit strings with coherent Chinese (e.g. 今天有点累了。 split into 今天有点 and 累了。; word units 今天/有/点). Preserve times. Replace the Japanese unit string in containment cases too.
2. Missing-word-timing test assigns `no()` with reason `asr does not report word timing`, then incorrectly expects `asr has no alignment support`. Preserve the distinct unit and capability reasons and assert both unchanged; never expect the validator to rewrite them.
3. `Object.defineProperty` on existing `speaker_id` and `asset_id` leaves their original enumerability intact. Both intended non-enumerable fixtures must explicitly specify `enumerable: false`. Assert their descriptors are actually non-enumerable before checking rejection.
4. `va(d, a = ASSET)` replaces explicitly passed undefined with ASSET, hiding an invalid asset in the asset-argument test. Call `validateAnnotatedAudio(doc(), a)` directly in that invalid-asset loop, or otherwise preserve explicitly supplied undefined. Omitted default fixture calls should remain valid.

Strengthen these existing checks without implementation changes:

- Parent containment: use an otherwise valid positive unit interval starting before a positive parent start (e.g. parent 200..1200, single unit 100..500). The current -5 case only proves rejection of negative time. Retain the end-after-parent case and assert a useful unit path.
- Non-exclusive score semantics: retain ordinal 7.4 and uncalibrated 120, additionally test two overlapping emotion observations with probability 0.7 and 0.8 (sum 1.5). Validate and confirm unchanged values; scores need not sum to one.
- Getter tests must also assert counter remains zero AFTER failed serialization.
- Include unknown-key rejection for the capabilities container itself, not just a nested capability record.

Do not loosen correct assertions to make tests pass. If a genuinely valid fixture reveals a source defect, report it and stop. Never claim full module acceptance. Return the changed file, actual test results and limitations.
