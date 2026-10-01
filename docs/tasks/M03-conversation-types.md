# M03 conversation and round domain types

Implementer: Qwen3.8-Flash through Codex CLI; official DeepSeek is authorized fallback under D22. Read AGENTS.md, voice-system-flow.md, docs/architecture.md and docs/sleep-work-plan.md. Only create apps/server/src/domain/conversation.ts in ONE write; no other files, Git, credentials, .env/data/.runtime, cloud calls or delegation. This is types only: no validators, provider implementations, timers, filesystem access or NestJS decorators. Import annotation types by type-only relative import. Keep erasable TypeScript and aim below 180 lines.

Define and export these provider-independent types exactly (comments explain boundaries):

- Persona: persona_id:string, name:string, instructions:string[]. Owner-authored configuration, distinct from quoted user speech.
- OwnerPreference: key:string, value:string. Explicit owner preference, never an inferred emotion/fact.
- HistoryTurn: turn_id:string, user_text:string, assistant_text:string|null, assistant_playback_completed:boolean.
- DialogueContext: persona:Persona, preferences:OwnerPreference[], current:{transcript:string, observations:Observation[], capability_gaps:string[]}, history:HistoryTurn[], truncated:boolean. Application bounds this content; current/history are untrusted conversational data, not tool instructions.
- ReplyExpressionSegment: text:string, tone:string, emotion_intensity:number, pace:number|null, pause_after_ms:number|null. Intensity is planned 0..1, not a recognition probability; pace is planned relative speed; pause is intended milliseconds. No actual speech boundaries.
- ReplyDraft: reply_text:string, segments:ReplyExpressionSegment[]. Ordered segment text covers the draft.
- ReplyPlan: reply_id:string, segments:ReplyExpressionSegment[]. Expression intention only; no measured audio timing.
- OutputAlignment: units:TimedUnit[], source:string. Timing refers to actual generated audio and retains provider/alignment provenance; cannot be derived from the reply plan alone.
- GeneratedSpeech: asset:AudioAsset, storage_key:string, alignment:OutputAlignment|null, applied_controls:string[], unsupported_controls:string[]. storage_key is server-internal, never exposed to browser/history context.
- RuntimeMode = 'live'|'development-mock'. Mock outputs are visibly labelled and never prove live voice quality.
- RoundStage = 'intake'|'analysis'|'context'|'dialogue'|'expression'|'synthesis'|'storage'|'complete'.
- RoundFailureCode = 'invalid_input'|'busy'|'not_found'|'provider_unavailable'|'cancelled'|'timed_out'|'provider_failed'|'invalid_result'|'storage_failed'.
- RoundFailure: code:RoundFailureCode, stage:RoundStage, message:string, retryable:boolean. Only safe static messages, never provider exception text or paths/keys/URLs.
- StageOutcome: status:'ok'|'unavailable'|'failed'|'skipped', reason?:string. Unavailable differs from completed, and reasons must be safe.
- TurnRecord: turn_id:string, session_id:string, client_request_id:string, created_at_ms:number, mode:RuntimeMode, source_asset:AudioAsset, input_asset:AudioAsset, annotation:AnnotatedAudio|null, reply_draft:ReplyDraft|null, reply_plan:ReplyPlan|null, output_asset:AudioAsset|null, output_alignment:OutputAlignment|null, applied_controls:string[], unsupported_controls:string[], playback_completed:boolean, stages:Partial<Record<RoundStage,StageOutcome>>, failure:RoundFailure|null. Original source and normalized analysis are distinct asset IDs with one clip-relative clock. Partial outcomes retain valid annotation and explicit unavailable stages. No raw provider payload, storage path or private reference in this public record.

Do not add optional provider SDK fields, concrete emotion label enums or secret configuration. Read back exports and, if possible, run strict noEmit TypeScript on this file. Report exact file/checks/limitations and a commit suggestion. The supervisor commits before any subsequent edit.
