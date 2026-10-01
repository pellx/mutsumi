/**
 * M03 - explicit unselected-provider implementations.
 *
 * These classes back the analysis, dialogue and speech-synthesis ports when a
 * runtime provider has not been configured. They are NOT development mocks and
 * NOT automatic fallback recognizers: each call fails fast without reading the
 * stored audio, the dialogue context or the reply plan, and without any network,
 * credential, storage or inference access. A shared, already-aborted signal is
 * preserved as its owned timed_out/cancelled failure rather than masked.
 */

import type { AnnotatedAudio } from '../../domain/annotation.ts';
import type {
  DialogueContext,
  GeneratedSpeech,
  ReplyDraft,
  ReplyPlan,
  RoundStage,
} from '../../domain/conversation.ts';
import type { DialoguePort, SpeechSynthesisPort } from '../../application/conversation-ports.ts';
import type {
  LocalAudioAnalysisPort,
  StoredAudio,
} from '../../application/analysis-ports.ts';
import { makeRoundError, toRoundFailure } from '../../application/round-errors.ts';

/** Throw the owned failure for a missing provider, honoring an aborted signal. */
function unavailable(stage: RoundStage, signal: AbortSignal): never {
  if (signal.aborted) {
    const failure = toRoundFailure(signal.reason, stage, signal);
    throw makeRoundError(failure.code, stage);
  }
  throw makeRoundError('provider_unavailable', stage);
}

/** Missing-configuration stand-in for local audio analysis. */
export class UnavailableAudioAnalysis implements LocalAudioAnalysisPort {
  async analyze(_audio: StoredAudio, options: { readonly signal: AbortSignal }): Promise<AnnotatedAudio> {
    unavailable('analysis', options.signal);
  }
}

/** Missing-configuration stand-in for dialogue generation. */
export class UnavailableDialogue implements DialoguePort {
  async generate(_context: DialogueContext, options: { readonly signal: AbortSignal }): Promise<ReplyDraft> {
    unavailable('dialogue', options.signal);
  }
}

/** Missing-configuration stand-in for speech synthesis. */
export class UnavailableSpeechSynthesis implements SpeechSynthesisPort {
  async synthesize(_plan: ReplyPlan, options: { readonly signal: AbortSignal }): Promise<GeneratedSpeech> {
    unavailable('synthesis', options.signal);
  }
}