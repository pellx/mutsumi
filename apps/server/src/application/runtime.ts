/** M03 - runtime composition. Never reads .env/process.env or starts HTTP/cloud. */
import { join, resolve, isAbsolute, sep } from 'node:path';
import type { RuntimeMode } from '../domain/conversation.ts';
import type {
  AudioStoragePort,
  DialoguePort,
  SpeechSynthesisPort,
} from './conversation-ports.ts';
import type { LocalAudioAnalysisPort } from './analysis-ports.ts';
import { RoundService } from './round-service.ts';
import { FileAudioStorage } from '../storage/file-audio-storage.ts';
import { FileConversationStore } from '../storage/file-conversation-store.ts';
import { NativeAudioIntake } from '../providers/local/native-audio-intake.ts';
import {
  UnavailableAudioAnalysis,
  UnavailableDialogue,
  UnavailableSpeechSynthesis,
} from '../providers/local/unavailable-providers.ts';
import {
  DevelopmentAudioAnalysis,
  DevelopmentDialogue,
  DevelopmentSpeechSynthesis,
} from '../providers/development/mock-conversation.ts';
import { GeminiAudioAnalysis } from '../providers/google/gemini-audio-analysis.ts';

export const RUNTIME_TOKEN = Symbol('mutsumi.runtime');

type HealthStatus = 'configured' | 'unavailable' | 'development-mock';

export type RuntimeHealth = {
  product: 'mutsumi';
  mode: RuntimeMode;
  session_id: string;
  limits: { max_audio_bytes: 10_485_760; max_duration_ms: 30_000 };
  analysis: { provider: string | null; model: string | null; status: HealthStatus; reason: string | null };
  dialogue: { provider: string | null; model: string | null; status: HealthStatus; reason: string | null };
  synthesis: { provider: string | null; model: string | null; status: HealthStatus; reason: string | null };
};

export type Runtime = {
  mode: RuntimeMode;
  sessionId: string;
  rounds: RoundService;
  audioStorage: AudioStoragePort;
  health: RuntimeHealth;
  webDirectory: string;
};

export type CreateRuntimeOptions = {
  projectRoot: string;
  dataDirectory?: string;
  mode: RuntimeMode;
  geminiApiKey?: string;
  freeTierConfirmed?: boolean;
  ffmpegBin?: string;
  ffprobeBin?: string;
};

function resolveDataDir(projectRoot: string, dataDirectory?: string): string {
  const base = resolve(projectRoot, 'data');
  if (dataDirectory === undefined || dataDirectory === '') return base;
  const resolved = resolve(projectRoot, dataDirectory);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error('dataDirectory must resolve within projectRoot/data');
  }
  return resolved;
}

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const { projectRoot, mode } = options;
  if (!isAbsolute(projectRoot)) {
    throw new Error('projectRoot must be an absolute path');
  }
  if (mode !== 'live' && mode !== 'development-mock') {
    throw new Error('mode must be "live" or "development-mock"');
  }
  const dataDir = resolveDataDir(projectRoot, options.dataDirectory);
  const webDirectory = join(projectRoot, 'apps', 'web', 'public');
  const ffmpegBin = options.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = options.ffprobeBin ?? 'ffprobe';

  const audioStorage = new FileAudioStorage({ rootDirectory: join(dataDir, 'assets') });
  const conversationStore = new FileConversationStore({ rootDirectory: join(dataDir, 'conversations') });
  const intake = new NativeAudioIntake({
    storage: audioStorage,
    workDirectory: join(dataDir, 'intake-work'),
    ffmpegBin,
    ffprobeBin,
  });

  const sessionId = mode === 'live' ? 'owner-live' : 'owner-development-mock';

  let analysis: LocalAudioAnalysisPort;
  let dialogue: DialoguePort;
  let synthesis: SpeechSynthesisPort;
  let analysisHealth: RuntimeHealth['analysis'];
  let dialogueHealth: RuntimeHealth['dialogue'];
  let synthesisHealth: RuntimeHealth['synthesis'];

  if (mode === 'live') {
    const hasKey = typeof options.geminiApiKey === 'string' && options.geminiApiKey.trim().length > 0;
    const confirmed = options.freeTierConfirmed === true;
    if (hasKey && confirmed) {
      analysis = new GeminiAudioAnalysis({
        apiKey: (options.geminiApiKey as string).trim(),
        freeTierConfirmed: true,
        timeoutMs: 60_000,
        readAudio: (key, opts) => audioStorage.readByKey(key, opts),
      });
      analysisHealth = { provider: 'google', model: 'gemini-3.8-flash', status: 'configured', reason: 'Configuration only; live verification pending.' };
    } else {
      analysis = new UnavailableAudioAnalysis();
      analysisHealth = { provider: null, model: null, status: 'unavailable', reason: 'Gemini API key or free-tier confirmation missing.' };
    }
    dialogue = new UnavailableDialogue();
    dialogueHealth = { provider: null, model: null, status: 'unavailable', reason: 'Dialogue model not selected.' };
    synthesis = new UnavailableSpeechSynthesis();
    synthesisHealth = { provider: null, model: null, status: 'unavailable', reason: 'Speech synthesis model not selected.' };
  } else {
    analysis = new DevelopmentAudioAnalysis();
    analysisHealth = { provider: 'development', model: 'fixed-fixture', status: 'development-mock', reason: 'Fixed-text transcript; no recognition performed.' };
    dialogue = new DevelopmentDialogue();
    dialogueHealth = { provider: 'development', model: 'fixed-fixture', status: 'development-mock', reason: 'Fixed reply text; no generation performed.' };
    synthesis = new DevelopmentSpeechSynthesis({ storage: audioStorage });
    synthesisHealth = { provider: 'development', model: 'fixed-fixture', status: 'development-mock', reason: 'Silent output; no speech synthesis performed.' };
  }

  const rounds = new RoundService({
    intake,
    analysis,
    dialogue,
    synthesis,
    store: conversationStore,
    mode,
    deadlineMs: 120_000,
  });

  const health: RuntimeHealth = {
    product: 'mutsumi',
    mode,
    session_id: sessionId,
    limits: { max_audio_bytes: 10_485_760, max_duration_ms: 30_000 },
    analysis: analysisHealth,
    dialogue: dialogueHealth,
    synthesis: synthesisHealth,
  };

  return { mode, sessionId, rounds, audioStorage, health, webDirectory };
}
