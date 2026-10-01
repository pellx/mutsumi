/**
 * M02 - validated native audio intake adapter.
 *
 * One concrete `AudioIntakePort`: it compares a browser-declared media type
 * against the actual container, decodes the clip to a canonical 16 kHz mono
 * analysis WAV with the installed ffmpeg/ffprobe executables, and stores the
 * untouched original plus that derived clip as two distinct private assets.
 *
 * Boundaries implemented here:
 * - A browser supplies bytes and a declared MIME type only: never a path, a
 *   file name or a storage key. The declared type is an untrusted claim that is
 *   compared against the sniffed container type.
 * - Native tools run through `runAudioTool` with fixed argument arrays and no
 *   shell; their bounded stdout is parsed field by field and never escapes
 *   verbatim.
 * - Only real inspected metadata becomes annotation: an absent sample rate or
 *   channel count stays `null`, and no timing, emotion or duration is invented.
 * - Both assets are stored only after container inspection and decoding have
 *   both succeeded. The analysis clip is a decode/resample of the original with
 *   no speed change, no filter and no intentional trim.
 * - Each call creates and then removes its own private work directory; no
 *   existing asset and no configured work root is ever deleted.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import type { AudioAsset } from '../../domain/annotation.ts';
import type {
  AudioIntakePort,
  AudioStoragePort,
  IntakeResult,
  IntakeSubmission,
} from '../../application/conversation-ports.ts';
import { runAudioTool } from '../../application/audio-tool-process.ts';
import { normalizePcmWave } from '../../application/pcm-wave.ts';
import { makeRoundError, toRoundFailure } from '../../application/round-errors.ts';

/** Canonical media types this adapter can verify from real container bytes. */
type SupportedAudioType =
  | 'audio/wav'
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/flac'
  | 'audio/aac'
  | 'audio/webm';

export type NativeAudioIntakeOptions = {
  readonly storage: AudioStoragePort;
  /** Absolute ignored private work root; resolved at runtime, never hard-coded. */
  readonly workDirectory: string;
  readonly ffmpegBin: string;
  readonly ffprobeBin: string;
};

type IntakeConfig = {
  readonly storage: AudioStoragePort;
  readonly workDirectory: string;
  readonly ffmpegBin: string;
  readonly ffprobeBin: string;
};

type ProbeResult = {
  readonly mediaType: SupportedAudioType;
  readonly containerSeconds: number | null;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
};

type EbmlElement = {
  readonly id: number;
  readonly contentOffset: number;
  readonly size: number;
  readonly sizeUnknown: boolean;
};

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_TYPE_LEN = 128;
const MAX_PATH_LEN = 4096;
const MAX_FORMAT_NAME_LEN = 256;
const MAX_COUNT = 1_000_000;
const MAX_CONTAINER_SECONDS = 30.25;
const TOOL_TIMEOUT_MS = 15_000;
const PROBE_MAX_OUTPUT_BYTES = 65_536;
const DECODE_MAX_OUTPUT_BYTES = 1_048_576;
const ANALYSIS_SAMPLE_RATE_HZ = 16_000;
const ANALYSIS_CHANNELS = 1;
const WORK_PREFIX = 'intake-';
const FORMAT_WHITELIST = 'wav,mp3,ogg,flac,matroska,webm,aac';
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const INTEGER_PATTERN = /^\d+$/;

const MIME_ALIASES: Readonly<Record<string, SupportedAudioType>> = {
  'audio/x-wav': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-flac': 'audio/flac',
};

const SUPPORTED_MEDIA_TYPES: ReadonlySet<string> = new Set<string>([
  'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/webm',
]);

/** An empty or generic declaration permits sniffing instead of comparison. */
const SNIFF_ONLY_TYPES: ReadonlySet<string> = new Set<string>([
  '', 'application/octet-stream',
]);

const EBML_HEADER_ID = 0x1a45_dfa3;
const EBML_DOC_TYPE_ID = 0x4282;
const EBML_HEADER_MAX_BYTES = 4096;
const EBML_HEADER_MAX_CHILDREN = 32;
const EBML_MAX_VINT_BYTES = 4;
const EBML_DOC_TYPE_MAX_LEN = 16;

function invalid(): never {
  throw makeRoundError('invalid_input', 'intake');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!isRecord(value)) return false;
  return typeof value['aborted'] === 'boolean'
    && typeof value['addEventListener'] === 'function'
    && typeof value['removeEventListener'] === 'function';
}

function requireSignal(options: unknown): AbortSignal {
  if (!isRecord(options)) return invalid();
  const signal = options['signal'];
  if (!isAbortSignal(signal)) return invalid();
  return signal;
}

function assertLive(signal: AbortSignal): void {
  if (signal.aborted) throw makeRoundError('cancelled', 'intake');
}

function requireWorkDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LEN
    || value.includes('\u0000') || !isAbsolute(value)) return invalid();
  return value;
}

function requireExecutable(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LEN
    || value.includes('\u0000')) return invalid();
  return value;
}

function readConfig(value: unknown): IntakeConfig {
  if (!isRecord(value)) return invalid();
  const storage = value['storage'];
  if (!isRecord(storage) || typeof storage['save'] !== 'function') return invalid();
  return {
    storage: storage as unknown as AudioStoragePort,
    workDirectory: requireWorkDirectory(value['workDirectory']),
    ffmpegBin: requireExecutable(value['ffmpegBin']),
    ffprobeBin: requireExecutable(value['ffprobeBin']),
  };
}

function snapshotBytes(submission: unknown): Uint8Array {
  if (!isRecord(submission)) return invalid();
  const raw = submission['bytes'];
  if (!(raw instanceof Uint8Array)) return invalid();
  if (raw.byteLength === 0 || raw.byteLength > MAX_INPUT_BYTES) return invalid();
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return copy;
}

function snapshotDeclaredMediaType(submission: unknown): string | null {
  if (!isRecord(submission)) return invalid();
  const declared = submission['declared_media_type'];
  if (typeof declared !== 'string') return invalid();
  if (declared.length > MAX_MEDIA_TYPE_LEN || declared.includes('\u0000')) {
    return invalid();
  }
  const separator = declared.indexOf(';');
  const base = (separator === -1 ? declared : declared.slice(0, separator)).trim().toLowerCase();
  if (SNIFF_ONLY_TYPES.has(base)) return null;
  const canonical = MIME_ALIASES[base] ?? base;
  if (!SUPPORTED_MEDIA_TYPES.has(canonical)) return invalid();
  return canonical;
}

function readSeconds(value: unknown): number | null {
  if (value === undefined) return null;
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return invalid();
  }
  if (text.toUpperCase() === 'N/A') return null;
  if (text === '') return invalid();
  if (!DECIMAL_PATTERN.test(text)) return invalid();
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds <= 0) return invalid();
  return seconds;
}

function readCount(value: unknown): number | null {
  if (value === undefined) return null;
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid();
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return invalid();
  }
  if (text.toUpperCase() === 'N/A') return null;
  if (text === '') return invalid();
  if (!INTEGER_PATTERN.test(text)) return invalid();
  const count = Number(text);
  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_COUNT) return invalid();
  return count;
}

function vintLength(first: number): number {
  let leading = 0;
  for (let mask = 0x80; mask !== 0 && (first & mask) === 0; mask >>= 1) leading += 1;
  return leading + 1;
}

function readElementId(
  bytes: Uint8Array, offset: number, limit: number,
): { id: number; length: number } | null {
  if (offset >= limit) return null;
  const length = vintLength(bytes[offset]!);
  if (length > EBML_MAX_VINT_BYTES || offset + length > limit) return null;
  let id = 0;
  for (let index = 0; index < length; index += 1) id = id * 256 + bytes[offset + index]!;
  return { id, length };
}

function readElementSize(
  bytes: Uint8Array, offset: number, limit: number,
): { size: number; length: number; unknown: boolean } | null {
  if (offset >= limit) return null;
  const first = bytes[offset]!;
  const length = vintLength(first);
  if (length > EBML_MAX_VINT_BYTES || offset + length > limit) return null;
  let size = first & (0xff >> length);
  for (let index = 1; index < length; index += 1) size = size * 256 + bytes[offset + index]!;
  return { size, length, unknown: size === 2 ** (7 * length) - 1 };
}

function readEbmlElement(bytes: Uint8Array, offset: number, limit: number): EbmlElement | null {
  const id = readElementId(bytes, offset, limit);
  if (id === null) return null;
  const size = readElementSize(bytes, offset + id.length, limit);
  if (size === null) return null;
  return {
    id: id.id,
    contentOffset: offset + id.length + size.length,
    size: size.size,
    sizeUnknown: size.unknown,
  };
}

function readAsciiCode(bytes: Uint8Array, offset: number, size: number): string | null {
  if (size < 1 || size > EBML_DOC_TYPE_MAX_LEN) return null;
  let text = '';
  for (let index = 0; index < size; index += 1) {
    const code = bytes[offset + index]!;
    if (code < 0x20 || code > 0x7e) return null;
    text += String.fromCharCode(code);
  }
  return text;
}

/**
 * Container inspection only: confirms the EBML header carries exactly one
 * DocType and that it is `webm`. Plain Matroska is rejected rather than
 * mislabelled. This is deliberately not a general EBML parser: it reads at
 * most 4096 bytes and 32 header children with checked ids, sizes and bounds.
 */
function ebmlHeaderDeclaresWebm(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, EBML_HEADER_MAX_BYTES);
  const header = readEbmlElement(bytes, 0, limit);
  if (header === null || header.id !== EBML_HEADER_ID || header.sizeUnknown) return false;
  const headerEnd = header.contentOffset + header.size;
  if (headerEnd > limit) return false;

  let offset = header.contentOffset;
  let children = 0;
  let docType: string | null = null;
  while (offset < headerEnd) {
    children += 1;
    if (children > EBML_HEADER_MAX_CHILDREN) return false;
    const child = readEbmlElement(bytes, offset, headerEnd);
    if (child === null || child.sizeUnknown) return false;
    const childEnd = child.contentOffset + child.size;
    if (childEnd > headerEnd) return false;
    if (child.id === EBML_DOC_TYPE_ID) {
      if (docType !== null) return false;
      const value = readAsciiCode(bytes, child.contentOffset, child.size);
      if (value === null) return false;
      docType = value;
    }
    offset = childEnd;
  }
  return docType === 'webm';
}

function detectActualMedia(formatName: string, original: Uint8Array): SupportedAudioType {
  let ebml = false;
  for (const token of formatName.toLowerCase().split(',')) {
    const name = token.trim();
    if (name === 'wav') return 'audio/wav';
    if (name === 'mp3') return 'audio/mpeg';
    if (name === 'ogg') return 'audio/ogg';
    if (name === 'flac') return 'audio/flac';
    if (name === 'aac') return 'audio/aac';
    if (name === 'matroska' || name === 'webm') ebml = true;
  }
  if (!ebml) return invalid();
  if (!ebmlHeaderDeclaresWebm(original)) return invalid();
  return 'audio/webm';
}

function parseProbe(bytes: Uint8Array, original: Uint8Array): ProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return invalid();
  }
  if (!isRecord(parsed)) return invalid();
  const format = parsed['format'];
  const streams = parsed['streams'];
  if (!isRecord(format)) return invalid();
  if (!Array.isArray(streams) || streams.length !== 1) return invalid();
  const stream = streams[0];
  if (!isRecord(stream) || stream['codec_type'] !== 'audio') return invalid();

  const formatName = format['format_name'];
  if (typeof formatName !== 'string' || formatName.length === 0
    || formatName.length > MAX_FORMAT_NAME_LEN) return invalid();
  const mediaType = detectActualMedia(formatName, original);

  const containerSeconds = readSeconds(format['duration']);
  if (containerSeconds !== null && containerSeconds > MAX_CONTAINER_SECONDS) return invalid();
  return {
    mediaType,
    containerSeconds,
    sampleRateHz: readCount(stream['sample_rate']),
    channels: readCount(stream['channels']),
  };
}

function buildOriginalAsset(probe: ProbeResult, decodedMilliseconds: number): AudioAsset {
  const containerMilliseconds = probe.containerSeconds === null
    ? null
    : Math.ceil(probe.containerSeconds * 1000);
  return {
    asset_id: randomUUID(),
    media_type: probe.mediaType,
    duration_ms: containerMilliseconds ?? decodedMilliseconds,
    sample_rate_hz: probe.sampleRateHz,
    channels: probe.channels,
  };
}

function buildAnalysisAsset(decodedMilliseconds: number): AudioAsset {
  return {
    asset_id: randomUUID(),
    media_type: 'audio/wav',
    duration_ms: decodedMilliseconds,
    sample_rate_hz: ANALYSIS_SAMPLE_RATE_HZ,
    channels: ANALYSIS_CHANNELS,
  };
}

export class NativeAudioIntake implements AudioIntakePort {
  private readonly storage: AudioStoragePort;
  private readonly workDirectory: string;
  private readonly ffmpegBin: string;
  private readonly ffprobeBin: string;

  constructor(options: NativeAudioIntakeOptions) {
    const config = readConfig(options);
    this.storage = config.storage;
    this.workDirectory = config.workDirectory;
    this.ffmpegBin = config.ffmpegBin;
    this.ffprobeBin = config.ffprobeBin;
  }

  async ingest(
    submission: IntakeSubmission,
    options: { readonly signal: AbortSignal },
  ): Promise<IntakeResult> {
    const signal = requireSignal(options);
    if (signal.aborted) throw makeRoundError('cancelled', 'intake');
    const input = snapshotBytes(submission);
    const declared = snapshotDeclaredMediaType(submission);

    let workDirectory: string | null = null;
    try {
      workDirectory = await this.createWorkDirectory(signal);
      assertLive(signal);
      const inputPath = join(workDirectory, 'input.bin');
      await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });

      const probeBytes = await runAudioTool({
        executable: this.ffprobeBin,
        args: [
          '-v', 'error',
          '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', FORMAT_WHITELIST,
          '-show_entries',
          'stream=codec_type,sample_rate,channels:format=format_name,duration',
          '-of', 'json',
          inputPath,
        ],
        signal,
        timeoutMs: TOOL_TIMEOUT_MS,
        maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
      });
      assertLive(signal);
      const probe = parseProbe(probeBytes, input);
      if (declared !== null && declared !== probe.mediaType) return invalid();

      const decodedBytes = await runAudioTool({
        executable: this.ffmpegBin,
        args: [
          '-nostdin',
          '-hide_banner',
          '-loglevel', 'error',
          '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', FORMAT_WHITELIST,
          '-i', inputPath,
          '-map', '0:a:0',
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-c:a', 'pcm_s16le',
          '-f', 'wav',
          'pipe:1',
        ],
        signal,
        timeoutMs: TOOL_TIMEOUT_MS,
        maxOutputBytes: DECODE_MAX_OUTPUT_BYTES,
      });
      assertLive(signal);
      const normalized = normalizePcmWave(decodedBytes);

      assertLive(signal);
      const original = await this.storage.save(
        input,
        buildOriginalAsset(probe, normalized.duration_ms),
      );
      assertLive(signal);
      const analysis = await this.storage.save(
        normalized.bytes,
        buildAnalysisAsset(normalized.duration_ms),
      );
      assertLive(signal);
      return { original, analysis };
    } catch (error) {
      throw makeRoundError(toRoundFailure(error, 'intake', signal).code, 'intake');
    } finally {
      await this.removeWorkDirectory(workDirectory);
    }
  }

  private async createWorkDirectory(signal: AbortSignal): Promise<string> {
    assertLive(signal);
    await mkdir(this.workDirectory, { recursive: true, mode: 0o700 });
    assertLive(signal);
    const directory = join(this.workDirectory, `${WORK_PREFIX}${randomUUID()}`);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    return directory;
  }

  /**
   * Removes only the directory this call created: a symlink is never followed,
   * the real path must be a direct child of the configured work root with the
   * intake prefix, and any failure is swallowed so it cannot mask the result.
   */
  private async removeWorkDirectory(directory: string | null): Promise<void> {
    if (directory === null) return;
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) return;
      const target = await realpath(directory);
      const root = await realpath(this.workDirectory);
      if (!isAbsolute(target) || !isAbsolute(root)) return;
      const name = basename(target);
      if (!name.startsWith(WORK_PREFIX)) return;
      if (dirname(target) !== root || target !== join(root, name)) return;
      await rm(target, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only: never mask the intake result or a prior failure.
    }
  }
}
