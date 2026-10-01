/**
 * M03 - application ports for the conversation round orchestration.
 *
 * Scope: interface/type declarations only. No implementations, mocks, HTTP or
 * NestJS wiring, no vendor SDK imports, no credentials, no filesystem access,
 * and no timers or retry behavior. Concrete adapters implement these ports.
 * Erasable TypeScript syntax only, so it runs unchanged under Node's built-in
 * type stripping.
 *
 * Boundaries implemented by this contract:
 * - Intake accepts browser-supplied bytes and a declared media type only. A
 *   browser never supplies a filesystem path or a storage key, and the declared
 *   MIME type is a client assertion the adapter must verify against the actual
 *   decoded media; it is never a trusted input.
 * - The original clip and the normalized analysis clip are distinct private
 *   assets that share one clip-relative time origin. They are stored separately
 *   and neither is reconstructed from the other.
 * - Dialogue and speech-synthesis providers are independent of the coding
 *   provider: nothing here couples runtime voice quality to the model that
 *   authored this file.
 * - Persona and owner preferences are explicit owner-authored configuration,
 *   never inferred memories or facts extracted from quoted user speech.
 * - Turn records are persisted honestly as partial results: unavailable stages
 *   stay unavailable, and assistant audio is not assumed heard until playback
 *   completion is explicitly recorded.
 * - Storage keys and byte-bearing reads are server-internal capabilities. They
 *   are never copied into a public TurnRecord, a browser response, or a model
 *   prompt.
 */

import type { AudioAsset } from '../domain/annotation.js';
import type {
  DialogueContext,
  GeneratedSpeech,
  HistoryTurn,
  OwnerPreference,
  Persona,
  ReplyDraft,
  ReplyPlan,
  TurnRecord,
} from '../domain/conversation.js';
import type { StoredAudio } from './analysis-ports.js';

/**
 * A single browser-submitted intake. Only bytes and a declared media type cross
 * the boundary: no path, no storage key, no server-side identifier. The declared
 * media type is a claim to validate against the actual decoded media.
 */
export type IntakeSubmission = {
  bytes: Uint8Array;
  declared_media_type: string;
};

/**
 * The two private assets produced by one intake: the untouched original and a
 * normalized analysis clip. Both share one clip-relative time origin; they are
 * distinct private assets and neither is derived from the other.
 */
export type IntakeResult = {
  original: StoredAudio;
  analysis: StoredAudio;
};

/**
 * Verifies declared media against the actual bytes, stores the original plus a
 * normalized analysis WAV (no speed change, no trimming) as opaque stored assets,
 * and returns both. It does not transcribe, reply, or synthesize. Cancellation
 * carries the shared bounded intake deadline; this port invents no timer.
 */
export type AudioIntakePort = {
  ingest(
    submission: IntakeSubmission,
    options: { readonly signal: AbortSignal },
  ): Promise<IntakeResult>;
};

/**
 * Generates a reply draft from an application-bounded dialogue context. Persona
 * and preferences are owner configuration; the current transcript and history
 * are quoted, untrusted speech that the caller must bound before it reaches any
 * model prompt.
 */
export type DialoguePort = {
  generate(
    context: DialogueContext,
    options: { readonly signal: AbortSignal },
  ): Promise<ReplyDraft>;
};

/**
 * Synthesizes speech for one reply plan. A plan carries intended tone, pace and
 * pauses only; produced audio and its actual alignment are validated separately
 * and never assumed from the plan. The synthesis provider is independent of the
 * coding provider.
 */
export type SpeechSynthesisPort = {
  synthesize(
    plan: ReplyPlan,
    options: { readonly signal: AbortSignal },
  ): Promise<GeneratedSpeech>;
};

/**
 * Owns conversation persistence for a round. Records are saved honestly as
 * partial results, and assistant audio counts as heard only after playback is
 * explicitly marked complete. Load methods return owner configuration and
 * bounded history; none expose a storage key or private reference.
 */
export type ConversationStorePort = {
  loadPersona(): Promise<Persona>;
  loadPreferences(sessionId: string): Promise<OwnerPreference[]>;
  recentHistory(sessionId: string, limit: number): Promise<HistoryTurn[]>;
  saveTurn(turn: TurnRecord): Promise<void>;
  getTurn(sessionId: string, turnId: string): Promise<TurnRecord | null>;
  markPlaybackCompleted(
    sessionId: string,
    turnId: string,
  ): Promise<TurnRecord>;
};

/**
 * A stored asset paired with its raw bytes. Both the bytes and the resolved
 * asset are server-internal capabilities that must never be copied into a
 * public TurnRecord, returned to the browser, or placed in a model prompt.
 */
export type StoredAssetRead = {
  asset: AudioAsset;
  bytes: Uint8Array;
};

/**
 * Saves bytes under an asset's generated opaque id and resolves stored audio for
 * server-side playback or analysis. A browser cannot supply a path or a storage
 * key: only the server resolves the opaque key against authorized storage.
 */
export type AudioStoragePort = {
  save(bytes: Uint8Array, asset: AudioAsset): Promise<StoredAudio>;
  readByKey(
    storageKey: string,
    options: { readonly signal: AbortSignal },
  ): Promise<Blob>;
  readById(assetId: string): Promise<StoredAssetRead | null>;
};
