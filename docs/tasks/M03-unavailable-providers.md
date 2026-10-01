# M03 explicit unselected providers

Create ONLY apps/server/src/providers/local/unavailable-providers.ts, exactly one write, no Git/other files. Read supplied context plus ONLY application/conversation-ports.ts, analysis-ports.ts and round-errors.ts; no need to reopen validators or discover files. No secrets/data/harness/provider calls. Primary Qwen3.8-Flash; D22 DeepSeek fallback authorized.

Export three small classes: UnavailableAudioAnalysis implements LocalAudioAnalysisPort (analyze StoredAudio,{signal}); UnavailableDialogue implements DialoguePort (generate DialogueContext,{signal}); UnavailableSpeechSynthesis implements SpeechSynthesisPort (synthesize ReplyPlan,{signal}). Each async method throws makeRoundError('provider_unavailable', respective stage analysis/dialogue/synthesis) without reading audio/context/plan, no network, credentials or inference. An already aborted native signal instead throws an owned error classified by toRoundFailure(signal.reason,stage,signal), preserving owned timed_out and ordinary cancelled. These are explicit missing-configuration providers, not development mocks and not automatic fallback recognizers.

Prefer <=70lines. Erasable TS, explicit .ts value imports and import type for domains. One write then npm run typecheck, report actual outcome and stop; supervisor commits and independently checks all three stages and cancellation.
