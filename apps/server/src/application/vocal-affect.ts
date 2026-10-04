import type { EmotionResult } from './input-stage-ports.ts';

export type VocalAffectProfile = {
  readonly segment_id: string;
  readonly label: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised' | 'disgusted' | 'unknown';
  readonly status: 'candidate' | 'unavailable';
  readonly valence: 'negative' | 'neutral' | 'positive' | 'mixed' | 'unknown';
  readonly arousal: 'low' | 'medium' | 'high' | 'unknown';
  readonly emotion_tags: readonly ('calm' | 'content' | 'amused' | 'excited' | 'curious' | 'surprised' | 'annoyed' | 'frustrated' | 'angry' | 'disappointed' | 'sad' | 'worried' | 'fearful' | 'uncertain' | 'relieved')[];
  readonly tone_tags: readonly ('conversational' | 'explanatory' | 'questioning' | 'emphatic' | 'tentative' | 'playful' | 'warm' | 'reassuring' | 'complaining' | 'detached')[];
  readonly delivery: {
    readonly pace: 'slow' | 'moderate' | 'fast' | 'variable' | 'unknown';
    readonly energy: 'soft' | 'moderate' | 'strong' | 'variable' | 'unknown';
    readonly pitch_variation: 'flat' | 'moderate' | 'wide' | 'unknown';
    readonly contour: 'rising' | 'falling' | 'level' | 'mixed' | 'unknown';
    readonly voice_quality: readonly ('clear' | 'breathy' | 'tense' | 'rough' | 'tremulous' | 'whispered')[];
  };
  readonly evidence: readonly { readonly dimension: 'emotion' | 'valence' | 'arousal' | 'pace' | 'energy' | 'pitch_variation' | 'contour' | 'voice_quality' | 'tone'; readonly description: string }[];
  readonly uncertainty: readonly ('noise' | 'music_leakage' | 'overlap' | 'separation_artifacts' | 'too_short' | 'language_uncertain' | 'ambiguous_delivery')[];
  readonly summary: string;
};

export type VocalAffectAnalysis = {
  readonly schema_version: 'vocal-affect-0.1';
  readonly basis: 'perceived_audio';
  readonly quality: 'owner_listening_pending';
  readonly profiles: readonly VocalAffectProfile[];
};

export type DetailedEmotionResult = EmotionResult & { readonly vocal_affect: VocalAffectAnalysis };

const profileKeys = ['segment_id', 'label', 'status', 'valence', 'arousal', 'emotion_tags', 'tone_tags', 'delivery', 'evidence', 'uncertainty', 'summary'] as const;
const deliveryKeys = ['pace', 'energy', 'pitch_variation', 'contour', 'voice_quality'] as const;
const evidenceKeys = ['dimension', 'description'] as const;
const labels = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted', 'unknown'] as const;
const valences = ['negative', 'neutral', 'positive', 'mixed', 'unknown'] as const;
const arousals = ['low', 'medium', 'high', 'unknown'] as const;
const emotions = ['calm', 'content', 'amused', 'excited', 'curious', 'surprised', 'annoyed', 'frustrated', 'angry', 'disappointed', 'sad', 'worried', 'fearful', 'uncertain', 'relieved'] as const;
const tones = ['conversational', 'explanatory', 'questioning', 'emphatic', 'tentative', 'playful', 'warm', 'reassuring', 'complaining', 'detached'] as const;
const paces = ['slow', 'moderate', 'fast', 'variable', 'unknown'] as const;
const energies = ['soft', 'moderate', 'strong', 'variable', 'unknown'] as const;
const pitches = ['flat', 'moderate', 'wide', 'unknown'] as const;
const contours = ['rising', 'falling', 'level', 'mixed', 'unknown'] as const;
const qualities = ['clear', 'breathy', 'tense', 'rough', 'tremulous', 'whispered'] as const;
const dimensions = ['emotion', 'valence', 'arousal', 'pace', 'energy', 'pitch_variation', 'contour', 'voice_quality', 'tone'] as const;
const uncertainties = ['noise', 'music_leakage', 'overlap', 'separation_artifacts', 'too_short', 'language_uncertain', 'ambiguous_delivery'] as const;

const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const textSchema = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const arraySchema = (items: Record<string, unknown>, maxItems: number) => ({ type: 'array', items, maxItems });

export function vocalAffectResponseSchema(ids: readonly string[]): Record<string, unknown> {
  if (!validIds(ids)) throw new Error('invalid_input');
  const evidence = { type: 'object', properties: { dimension: enumSchema(dimensions), description: textSchema(160) }, required: [...evidenceKeys], additionalProperties: false };
  const delivery = {
    type: 'object',
    properties: {
      pace: enumSchema(paces), energy: enumSchema(energies), pitch_variation: enumSchema(pitches),
      contour: enumSchema(contours), voice_quality: arraySchema(enumSchema(qualities), 2),
    },
    required: [...deliveryKeys], additionalProperties: false,
  };
  const profile = {
    type: 'object',
    properties: {
      segment_id: { type: 'string', enum: [...ids] }, label: enumSchema(labels), status: enumSchema(['candidate', 'unavailable']),
      valence: enumSchema(valences), arousal: enumSchema(arousals),
      emotion_tags: arraySchema(enumSchema(emotions), 3), tone_tags: arraySchema(enumSchema(tones), 3),
      delivery, evidence: arraySchema(evidence, 9), uncertainty: arraySchema(enumSchema(uncertainties), 5), summary: textSchema(180),
    },
    required: [...profileKeys], additionalProperties: false,
  };
  return { type: 'object', properties: { segments: { type: 'array', items: profile, minItems: ids.length, maxItems: ids.length } }, required: ['segments'], additionalProperties: false };
}

type PlainRecord = Record<string, unknown>;
function record(value: unknown, keys: readonly string[]): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
  });
}

function cleanString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes(String.fromCharCode(0)) && [...value].length <= max;
}
function oneOf(value: unknown, options: readonly string[]): value is string { return typeof value === 'string' && options.includes(value); }
function strictArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) return false;
  }
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  return Boolean(length && 'value' in length && length.value === value.length);
}
function uniqueValues<T extends string>(values: readonly T[]): boolean { return new Set(values).size === values.length; }
function validIds(ids: unknown): ids is readonly string[] {
  if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(ids);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(ids, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor) || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 1 || lengthDescriptor.value > 100 || keys.length !== lengthDescriptor.value + 1) return false;
  const values: string[] = [];
  for (let i = 0; i < lengthDescriptor.value; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(ids, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !cleanString(descriptor.value, 128)) return false;
    values.push(descriptor.value);
  }
  return uniqueValues(values);
}

export function parseVocalAffectProfiles(value: unknown, ids: readonly string[]): VocalAffectProfile[] | null {
  if (!validIds(ids) || !record(value, ['segments']) || !strictArray(value.segments, 100) || value.segments.length !== ids.length) return null;
  const output: VocalAffectProfile[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = value.segments[i];
    if (!record(raw, profileKeys) || raw.segment_id !== ids[i] || !cleanString(raw.segment_id, 128) || !oneOf(raw.label, labels) || !oneOf(raw.status, ['candidate', 'unavailable']) || !oneOf(raw.valence, valences) || !oneOf(raw.arousal, arousals) || !cleanString(raw.summary, 180)) return null;
    if (!strictArray(raw.emotion_tags, 3) || !raw.emotion_tags.every((x) => oneOf(x, emotions)) || !uniqueValues(raw.emotion_tags as string[])) return null;
    if (!strictArray(raw.tone_tags, 3) || !raw.tone_tags.every((x) => oneOf(x, tones)) || !uniqueValues(raw.tone_tags as string[])) return null;
    if (!record(raw.delivery, deliveryKeys)) return null;
    const d = raw.delivery;
    if (!oneOf(d.pace, paces) || !oneOf(d.energy, energies) || !oneOf(d.pitch_variation, pitches) || !oneOf(d.contour, contours) || !strictArray(d.voice_quality, 2) || !d.voice_quality.every((x) => oneOf(x, qualities)) || !uniqueValues(d.voice_quality as string[])) return null;
    if (!strictArray(raw.evidence, 9)) return null;
    const ev: { dimension: VocalAffectProfile['evidence'][number]['dimension']; description: string }[] = [];
    for (const item of raw.evidence) {
      if (!record(item, evidenceKeys) || !oneOf(item.dimension, dimensions) || !cleanString(item.description, 160)) return null;
      ev.push({ dimension: item.dimension as VocalAffectProfile['evidence'][number]['dimension'], description: item.description });
    }
    const evidenceDimensions = ev.map((x) => x.dimension);
    if (!uniqueValues(evidenceDimensions)) return null;
    if (!strictArray(raw.uncertainty, 5) || !raw.uncertainty.every((x) => oneOf(x, uncertainties)) || !uniqueValues(raw.uncertainty as string[])) return null;
    const claims = new Set<string>();
    if (raw.label !== 'unknown') claims.add('emotion');
    if ((raw.emotion_tags as string[]).length) claims.add('emotion');
    if (raw.valence !== 'unknown') claims.add('valence');
    if (raw.arousal !== 'unknown') claims.add('arousal');
    if (d.pace !== 'unknown') claims.add('pace');
    if (d.energy !== 'unknown') claims.add('energy');
    if (d.pitch_variation !== 'unknown') claims.add('pitch_variation');
    if (d.contour !== 'unknown') claims.add('contour');
    if ((d.voice_quality as string[]).length) claims.add('voice_quality');
    if ((raw.tone_tags as string[]).length) claims.add('tone');
    if (claims.size !== evidenceDimensions.length || evidenceDimensions.some((dimension) => !claims.has(dimension))) return null;
    if (raw.status === 'candidate' && claims.size === 0) return null;
    if (raw.status === 'unavailable' && (raw.label !== 'unknown' || raw.valence !== 'unknown' || raw.arousal !== 'unknown' || d.pace !== 'unknown' || d.energy !== 'unknown' || d.pitch_variation !== 'unknown' || d.contour !== 'unknown' || (raw.emotion_tags as string[]).length !== 0 || (raw.tone_tags as string[]).length !== 0 || (d.voice_quality as string[]).length !== 0 || ev.length !== 0 || (raw.uncertainty as string[]).length === 0)) return null;
    output.push({
      segment_id: raw.segment_id, label: raw.label as VocalAffectProfile['label'], status: raw.status as VocalAffectProfile['status'],
      valence: raw.valence as VocalAffectProfile['valence'], arousal: raw.arousal as VocalAffectProfile['arousal'],
      emotion_tags: [...raw.emotion_tags] as VocalAffectProfile['emotion_tags'], tone_tags: [...raw.tone_tags] as VocalAffectProfile['tone_tags'],
      delivery: { pace: d.pace as VocalAffectProfile['delivery']['pace'], energy: d.energy as VocalAffectProfile['delivery']['energy'], pitch_variation: d.pitch_variation as VocalAffectProfile['delivery']['pitch_variation'], contour: d.contour as VocalAffectProfile['delivery']['contour'], voice_quality: [...d.voice_quality] as VocalAffectProfile['delivery']['voice_quality'] },
      evidence: ev, uncertainty: [...raw.uncertainty] as VocalAffectProfile['uncertainty'], summary: raw.summary,
    });
  }
  return output;
}

export function validateVocalAffectAnalysis(value: unknown, ids: readonly string[]): VocalAffectAnalysis | null {
  if (!record(value, ['schema_version', 'basis', 'quality', 'profiles']) || value.schema_version !== 'vocal-affect-0.1' || value.basis !== 'perceived_audio' || value.quality !== 'owner_listening_pending') return null;
  const profiles = parseVocalAffectProfiles({ segments: value.profiles }, ids);
  return profiles ? { schema_version: 'vocal-affect-0.1', basis: 'perceived_audio', quality: 'owner_listening_pending', profiles } : null;
}
