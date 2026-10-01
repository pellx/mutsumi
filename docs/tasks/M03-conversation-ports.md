# M03 application ports

Implementer: Qwen3.8-Flash; D22 authorizes official DeepSeek fallback on failure. Read AGENTS.md, voice-system-flow.md, docs/architecture.md, docs/sleep-work-plan.md and only the type declarations in domain/conversation.ts and application/analysis-ports.ts. Only create apps/server/src/application/conversation-ports.ts in ONE write. No other edits, Git, configuration discovery, private files, cloud calls or delegation. Known Node/TypeScript flags are provided by the launcher; do not search for tsconfig. This file declares interfaces only.

Export these types, importing existing domain/StoredAudio types with type-only relative imports:

```ts
export type IntakeSubmission = {
  bytes: Uint8Array;
  declared_media_type: string;
};
export type IntakeResult = {
  original: StoredAudio;
  analysis: StoredAudio;
};
export type AudioIntakePort = {
  ingest(submission: IntakeSubmission, options: { readonly signal: AbortSignal }): Promise<IntakeResult>;
};
export type DialoguePort = {
  generate(context: DialogueContext, options: { readonly signal: AbortSignal }): Promise<ReplyDraft>;
};
export type SpeechSynthesisPort = {
  synthesize(plan: ReplyPlan, options: { readonly signal: AbortSignal }): Promise<GeneratedSpeech>;
};
export type ConversationStorePort = {
  loadPersona(): Promise<Persona>;
  loadPreferences(sessionId: string): Promise<OwnerPreference[]>;
  recentHistory(sessionId: string, limit: number): Promise<HistoryTurn[]>;
  saveTurn(turn: TurnRecord): Promise<void>;
  getTurn(sessionId: string, turnId: string): Promise<TurnRecord | null>;
  markPlaybackCompleted(sessionId: string, turnId: string): Promise<TurnRecord>;
};
export type StoredAssetRead = {
  asset: AudioAsset;
  bytes: Uint8Array;
};
export type AudioStoragePort = {
  save(bytes: Uint8Array, asset: AudioAsset): Promise<StoredAudio>;
  readByKey(storageKey: string, options: { readonly signal: AbortSignal }): Promise<Blob>;
  readById(assetId: string): Promise<StoredAssetRead | null>;
};
```

Comments must explain: browser input never supplies paths/storage keys; MIME is a declaration to verify against actual media; original and normalized audio are distinct private assets sharing a clip-relative time origin; speech providers are independent of coding providers; persona/preferences are explicit owner configuration, not inferred memories; partial turn records are persisted honestly and assistant audio is not assumed heard until playback completion. Storage keys/byte-bearing reads are internal, never copied into public TurnRecord or model prompts. No provider SDK types, credentials, filesystem or timers.

Read back exports and run strict noEmit TypeScript on the target. Report actual checks, exact file and commit suggestion; supervisor commits before the next file edit.
