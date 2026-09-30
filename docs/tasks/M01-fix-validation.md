# M01 — validation repair, single-file phase

Released 2026-10-01. Project final name: mutsumi (supersedes wakaba references).

Read AGENTS.md and docs/tasks/M01-annotation-contracts.md, then inspect apps/server/src/domain/annotation.ts. ONLY modify that source file, in exactly ONE patch. Supervisor commits it immediately after your return. No tests/config/docs edits, dependency installs or Git writes. Run read-only checks and report proposed commit text. Stop on repeated infrastructure errors.

Required repairs:

1. Replace the dead ASSET_ROOT ternary in validateAudioAsset with DOCUMENT_ROOT.
2. parseAnnotatedAudio must return an issue at $ for a runtime non-string argument, including null/undefined/object/number; do not throw. Remove pushUnreachableGuard.
3. Sparse arrays are malformed JSON-domain containers. Current forEach skips holes: a document with segments:new Array(1) incorrectly passes and serializes to [null]. Detect missing own indexed elements in every schema array (segments, observations, units, segment_ids); return useful indexed issues, without mutating input. Dense arrays and empty arrays remain valid. Reject non-index enumerable array properties so round-trip cannot silently drop data.
4. isJsonObject should only accept plain JSON records (Object.prototype or null prototype), not class instances or custom inherited-field objects. Otherwise Object.create(validDocument) passes and serializes to {}. Reject own accessor fields and symbol keys rather than reading them; the validator must not invoke user getters. Ordinary parsed JSON and null-prototype own-property records remain supported. Do not introduce unnecessary general graph-processing frameworks.

Verify with synthetic inline Node commands (do not write another file), and a strict dependency-free compiler check if the installed npm exec compiler is available:
`npm exec --yes --package=typescript@7.0.2 -- tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext apps/server/src/domain/annotation.ts`.

Acceptance: non-string parser input returns ok:false, sparse arrays and custom-prototype records return ok:false, getters are not invoked, valid document round-trips unchanged. Only one modification patch, even if you notice another defect: report it for supervisor follow-up instead.
