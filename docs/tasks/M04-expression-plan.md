# M04 deterministic expression planning

Qwen3.8-Flash; official DeepSeek fallback D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md, domain/conversation.ts and application/round-errors.ts. Source paths under apps/server/src. Create ONLY apps/server/src/application/expression-plan.ts, ONE write, no Git/launchers/secrets/cloud/discovery/other edits. Supervisor commits. Existing validator signatures: validateReplyDraft(unknown):ValidationResult<ReplyDraft>; validateReplyPlan(unknown):ValidationResult<ReplyPlan>, from ../domain/conversation-validation.ts. No validator internals need reading.

Export buildReplyPlan(draft:ReplyDraft, replyId:string):ReplyPlan. Validate draft before any field access, then construct a plain plan from the supplied ID and structuredClone of valid draft.segments, validate the plan, and throw makeRoundError('invalid_result','expression') on any invalid input. Return independent segment objects. Preserve every text/tone/intensity/pace/pause byte/value; do not infer emotions, synthesize audio, add actual times or split segments. Planned pause zero is valid and null remains null. No automatic Jev or vendor controls. Around 25 lines; no new types beyond necessary imports.

Build in memory, write once. Run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json. Report actual check/file and commit suggestion, then stop.
