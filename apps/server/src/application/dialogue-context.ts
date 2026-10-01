// application/dialogue-context.ts
// M03 bounded dialogue context builder.

import type { AudioAsset, AnnotatedAudio, Observation } from '../domain/annotation.ts';
import type { Persona, OwnerPreference, HistoryTurn, DialogueContext } from '../domain/conversation.ts';
import { validateAnnotatedAudio } from '../domain/annotation.ts';
import { validatePersona, validatePreferences, validateHistoryTurns } from '../domain/conversation-validation.ts';
import { makeRoundError } from './round-errors.ts';

const MAX_TRANSCRIPT = 6000;
const MAX_HISTORY_TEXT = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_OBSERVATIONS = 32;
const MAX_BOUND_STRING = 128;
const MAX_SEGMENT_IDS = 64;
const MAX_SEGMENT_ID_STRING = 128;
const MAX_TIMING_PROVENANCE = 256;
const MAX_OBSERVATION_SERIALIZED = 16384;
const REQUIRED_KEYS: readonly string[] = ['asset', 'annotation', 'persona', 'preferences', 'history'];

type Input = {
  asset: AudioAsset;
  annotation: AnnotatedAudio;
  persona: Persona;
  preferences: OwnerPreference[];
  history: HistoryTurn[];
};

function safeClip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max;
  const prev = s.charCodeAt(cut - 1);
  if (prev >= 0xD800 && prev <= 0xDBFF) cut -= 1;
  return s.slice(0, cut);
}

function assertPlainInput(input: unknown): asserts input is Input {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw makeRoundError('invalid_result', 'context');
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    throw makeRoundError('invalid_result', 'context');
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw makeRoundError('invalid_result', 'context');
  }
  const names = Object.getOwnPropertyNames(input);
  if (names.length !== REQUIRED_KEYS.length || !names.every(n => REQUIRED_KEYS.includes(n))) {
    throw makeRoundError('invalid_result', 'context');
  }
  for (const key of REQUIRED_KEYS) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (d === undefined || !('value' in d) || d.enumerable !== true) {
      throw makeRoundError('invalid_result', 'context');
    }
  }
}

function isOverlong(obs: Observation): boolean {
  if (obs.observation_id.length > MAX_BOUND_STRING
    || obs.label.length > MAX_BOUND_STRING
    || obs.source_provider.length > MAX_BOUND_STRING
    || obs.source_model.length > MAX_BOUND_STRING) {
    return true;
  }
  if (obs.segment_ids !== undefined) {
    if (obs.segment_ids.length > MAX_SEGMENT_IDS) return true;
    if (obs.segment_ids.some(id => id.length > MAX_SEGMENT_ID_STRING)) return true;
  }
  if (obs.timing.status === 'available') {
    if (obs.timing.source.length > MAX_TIMING_PROVENANCE) return true;
  } else if (obs.timing.reason.length > MAX_TIMING_PROVENANCE) {
    return true;
  }
  return false;
}

function capabilityGaps(ann: AnnotatedAudio): string[] {
  const caps = ann.capabilities;
  const dims: [string, typeof caps.word_timing][] = [
    ['word_timing', caps.word_timing],
    ['emotion', caps.emotion],
    ['prosody', caps.prosody],
    ['sound_event', caps.sound_event],
  ];
  return dims.filter(([, c]) => c.status !== 'ok').map(([d, c]) => `${d}:${c.status}`);
}

export function buildDialogueContext(input: Input): DialogueContext {
  assertPlainInput(input);
  const annR = validateAnnotatedAudio(input.annotation, input.asset);
  const perR = validatePersona(input.persona);
  const prefR = validatePreferences(input.preferences);
  const histR = validateHistoryTurns(input.history);
  if (!annR.ok || !perR.ok || !prefR.ok || !histR.ok) {
    throw makeRoundError('invalid_result', 'context');
  }
  let truncated = false;
  const annotation = annR.value;
  const rawT = annotation.transcript;
  const transcript = safeClip(rawT, MAX_TRANSCRIPT);
  if (transcript.length < rawT.length) truncated = true;

  const allObs = annotation.observations;
  const candidates = allObs.slice(0, MAX_OBSERVATIONS);
  if (allObs.length > MAX_OBSERVATIONS) truncated = true;
  const observations: Observation[] = [];
  let serializedTotal = 0;
  for (const obs of candidates) {
    if (isOverlong(obs)) { truncated = true; continue; }
    const serializedSize = JSON.stringify(obs).length;
    if (serializedTotal + serializedSize > MAX_OBSERVATION_SERIALIZED) {
      truncated = true;
      continue;
    }
    serializedTotal += serializedSize;
    observations.push(structuredClone(obs));
  }

  const allHist = histR.value;
  const kept = allHist.slice(-MAX_HISTORY_TURNS);
  if (allHist.length > MAX_HISTORY_TURNS) truncated = true;
  const history: HistoryTurn[] = kept.map(turn => {
    const u = safeClip(turn.user_text, MAX_HISTORY_TEXT);
    const a = turn.assistant_text !== null ? safeClip(turn.assistant_text, MAX_HISTORY_TEXT) : null;
    if (u.length < turn.user_text.length
      || (a !== null && turn.assistant_text !== null && a.length < turn.assistant_text.length)) {
      truncated = true;
    }
    return { turn_id: turn.turn_id, user_text: u, assistant_text: a, assistant_playback_completed: turn.assistant_playback_completed };
  });

  return {
    persona: structuredClone(perR.value),
    preferences: structuredClone(prefR.value),
    current: { transcript, observations, capability_gaps: capabilityGaps(annotation) },
    history,
    truncated,
  };
}