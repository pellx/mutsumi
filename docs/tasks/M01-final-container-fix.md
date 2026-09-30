# M01 — finish lossless JSON container validation

Project: mutsumi. H00 accepted. Modify ONLY apps/server/src/domain/annotation.ts in exactly ONE patch, then run read-only inline checks and stop for supervisor commit. Read AGENTS.md and the prior M01 briefs. No other files, install commands, Git writes or connector discovery.

The supervisor's compiler check of 92fda31 passed. Finish two residual cases in the existing helpers, without a general graph validator:

1. checkRecordShape must reject any non-enumerable own data property, including known schema fields. Otherwise a valid document whose transcript is non-enumerable passes and loses required transcript on serialization; an unknown non-enumerable property evades checkKnownKeys. Return false before fields are read. All JSON record keys must be enumerable plain data properties. Null prototype remains valid.
2. checkArrayShape must reject indexed getter/setter properties before forEach reads them, and reject non-index own properties even when non-enumerable (except the built-in length property). Accept only ordinary Array.prototype arrays to avoid inherited custom serialization. On any shape problem return false so callers never read dangerous elements. Preserve useful indexed issues for holes. Do not invoke getters. Dense ordinary arrays remain valid.

Use synthetic inline verification for known/unknown non-enumerable fields, indexed getter that throws (getter count must remain 0), nested unit getter, non-enumerable extra array key, normal valid document and null-prototype records. Report actual results and suggest one commit message. If further defects appear, report rather than making another patch. Supervisor runs tsc separately; do not request network or dependency installs.
