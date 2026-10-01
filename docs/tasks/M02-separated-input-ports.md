# M02 separated input ports

Owner approved CLI-first stages and GPT-6-Luna coding (D25). This task is independent of the pending timing provider decision.

Create ONLY apps/server/src/application/input-stage-ports.ts exactly once. Read ONLY apps/server/src/application/analysis-ports.ts and first 140 lines of apps/server/src/domain/annotation.ts. Required architectural documents are preloaded. No other files, no credentials, no cloud calls, no real recordings.

Implement erasable TypeScript type declarations only, vendor independent. Import types StoredAudio, AudioAsset/AnnotatedAudio/Observation/Capability/TranscriptSegment/Timing. Export:
- UntimedTranscription: readonly asset_id, transcript string, source_provider and source_model; readonly sound_events array of Observation restricted kind sound_event, and readonly sound_event_capability Capability. Text transcription contains no segments, units or word timestamps. Sound events may have explicit unavailable timing; model-estimate source when available.
- TranscriptionPort.transcribe(audio: StoredAudio, options: {readonly signal: AbortSignal}): Promise<UntimedTranscription>.
- TimingPort.align(audio: StoredAudio, transcription: UntimedTranscription, options same): Promise<AnnotatedAudio>. Contract complete normalized lexical agreement; keeps transcription content, uses actual provider units, does not invent or divide boundaries. Not a claim of any chosen provider's forced alignment capability. Timing output contains timing only, emotion/prosody/sound_event unavailable and observations empty; orchestrator adds sound observations later.
- EmotionInput: readonly asset_id, transcript and deeply readonly segments (including readonly unit array and readonly nested timings) projected from existing domain shapes, no paths/provider SDK types.
- EmotionResult: readonly asset_id, readonly observations array restricted kind emotion, readonly capability Capability. Observations reference existing segment IDs; no replacement transcript/segments. Candidate labels, unknown explicit, no invented scores. Emotion span may cover multiple units.
- EmotionPort.observe(audio: StoredAudio, alignment: EmotionInput, options same): Promise<EmotionResult>.
- InputStage = transcription | timing | emotion. No orchestration implementation here.

Comment that runtime validators must enforce IDs, bounds, source and mutation protection; type-only readonly is not runtime protection. No generic overengineering, timers, retries or schemas.

After exactly one write run node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json. Stop and report actual result and proposed commit message. Supervisor performs commit.
