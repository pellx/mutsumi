import type { AudioAsset } from '../domain/annotation.ts';
import { validateAudioAsset } from '../domain/annotation.ts';
import type { StoredAudio } from './analysis-ports.ts';

export type SceneSoundCategory = 'music' | 'environment' | 'effect' | 'nonverbal_voice' | 'unknown';

export type WholeAudioSoundEvent = {
  event_id: string;
  category: SceneSoundCategory;
  description: string;
};

export type WholeAudioAnalysis = {
  asset_id: string;
  source_track: 'original_mix';
  source_provider: string;
  source_model: string;
  scene_summary: string;
  audible_features: string[];
  sound_events: WholeAudioSoundEvent[];
  uncertainties: string[];
  timing: { status: 'unavailable'; reason: 'whole audio descriptions have no event alignment' };
};

export type WholeAudioAnalysisPort = {
  analyze(audio: StoredAudio, options: { readonly signal: AbortSignal }): Promise<WholeAudioAnalysis>;
};

const INVALID = { ok: false, reason: 'invalid_result' } as const;
const ROOT_KEYS = ['asset_id', 'source_track', 'source_provider', 'source_model', 'scene_summary', 'audible_features', 'sound_events', 'uncertainties', 'timing'];
const EVENT_KEYS = ['event_id', 'category', 'description'];
const TIMING_KEYS = ['status', 'reason'];
const CATEGORIES = new Set(['music', 'environment', 'effect', 'nonverbal_voice', 'unknown']);
const utf8 = new TextEncoder();

function plainRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length) return false;
  for (const key of names) {
    if (!keys.includes(key)) return false;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) return false;
  }
  return true;
}

function denseArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return false;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) return false;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  for (let i = 0; i < value.length; i++) {
    if (!Object.getOwnPropertyDescriptor(value, String(i))) return false;
  }
  return true;
}

function validText(value: unknown, min: number, max: number, metadata: boolean): value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max) return false;
  if (min > 0 && value.trim().length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (metadata ? (c <= 31 || (c >= 127 && c <= 159)) : ((c <= 31 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c <= 159))) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

export function validateWholeAudioAnalysis(value: unknown, asset: AudioAsset): { ok: true; value: WholeAudioAnalysis } | { ok: false; reason: 'invalid_result' } {
  try {
    const checkedAsset = validateAudioAsset(asset);
    if (!checkedAsset.ok || !plainRecord(value, ROOT_KEYS)) return INVALID;
    const input = value;
    if (!validText(input.asset_id, 1, 128, true) || input.asset_id !== checkedAsset.value.asset_id) return INVALID;
    if (input.source_track !== 'original_mix') return INVALID;
    if (!validText(input.source_provider, 1, 128, true) || !validText(input.source_model, 1, 128, true)) return INVALID;
    if (!validText(input.scene_summary, 0, 1000, false)) return INVALID;
    if (!denseArray(input.audible_features, 16) || !denseArray(input.uncertainties, 16) || !denseArray(input.sound_events, 32)) return INVALID;
    const features: string[] = [];
    for (const item of input.audible_features) {
      if (!validText(item, 1, 160, false)) return INVALID;
      features.push(item);
    }
    const uncertainties: string[] = [];
    for (const item of input.uncertainties) {
      if (!validText(item, 1, 160, false)) return INVALID;
      uncertainties.push(item);
    }
    const ids = new Set<string>();
    const events: WholeAudioSoundEvent[] = [];
    for (const raw of input.sound_events) {
      if (!plainRecord(raw, EVENT_KEYS)) return INVALID;
      if (!validText(raw.event_id, 1, 128, true) || ids.has(raw.event_id)) return INVALID;
      if (typeof raw.category !== 'string' || !CATEGORIES.has(raw.category)) return INVALID;
      if (!validText(raw.description, 1, 256, false)) return INVALID;
      ids.add(raw.event_id);
      events.push({ event_id: raw.event_id, category: raw.category as SceneSoundCategory, description: raw.description });
    }
    if (!plainRecord(input.timing, TIMING_KEYS) || input.timing.status !== 'unavailable' || input.timing.reason !== 'whole audio descriptions have no event alignment') return INVALID;
    const result: WholeAudioAnalysis = {
      asset_id: input.asset_id,
      source_track: 'original_mix',
      source_provider: input.source_provider,
      source_model: input.source_model,
      scene_summary: input.scene_summary,
      audible_features: features,
      sound_events: events,
      uncertainties,
      timing: { status: 'unavailable', reason: 'whole audio descriptions have no event alignment' },
    };
    if (utf8.encode(JSON.stringify(result)).byteLength > 16384) return INVALID;
    return { ok: true, value: result };
  } catch {
    return INVALID;
  }
}
