/**
 * M02 - private local audio storage adapter.
 *
 * Stores validated assets under a trusted, server-configured directory that
 * composition places beneath the ignored data/ tree. Asset IDs and storage keys
 * are canonical UUID v4 values generated upstream (intake uses randomUUID); the
 * storage key is identical to the asset id and stays server-internal. No user
 * filenames, no public paths, no format/timing inference, no provider calls and
 * no credential handling. Business errors are safe round errors only.
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { validateAudioAsset } from '../domain/annotation.ts';
import type { AudioAsset } from '../domain/annotation.ts';
import type {
  AudioStoragePort,
  StoredAssetRead,
} from '../application/conversation-ports.ts';
import type { StoredAudio } from '../application/analysis-ports.ts';
import { makeRoundError } from '../application/round-errors.ts';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;
const METADATA_FILE = 'metadata.json';
const BYTES_FILE = 'bytes.bin';
const PENDING_PREFIX = '.pending-';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export class FileAudioStorage implements AudioStoragePort {
  readonly rootDirectory: string;

  constructor(options: { rootDirectory: string }) {
    const root = options.rootDirectory;
    if (typeof root !== 'string' || root.length === 0 || !path.isAbsolute(root)) {
      throw makeRoundError('invalid_input', 'storage');
    }
    this.rootDirectory = path.resolve(root);
  }

  async save(bytes: Uint8Array, asset: AudioAsset): Promise<StoredAudio> {
    if (!(bytes instanceof Uint8Array)) throw this.invalid();
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AUDIO_BYTES) throw this.invalid();
    const checked = validateAudioAsset(asset);
    if (!checked.ok) throw this.invalid();
    const value = checked.value;
    const assetId = value.asset_id;
    if (!isUuidV4(assetId)) throw this.invalid();

    const storedAsset: AudioAsset = {
      asset_id: assetId,
      media_type: value.media_type,
      duration_ms: value.duration_ms,
      sample_rate_hz: value.sample_rate_hz,
      channels: value.channels,
    };
    const metadataBytes = Buffer.from(JSON.stringify(storedAsset), 'utf8');
    if (metadataBytes.byteLength > MAX_METADATA_BYTES) throw this.invalid();
    // Snapshot bytes and metadata before the first await; retain them verbatim.
    const byteSnapshot = Buffer.from(bytes);
    const directory = path.join(this.rootDirectory, assetId);
    const pending = path.join(this.rootDirectory, `${PENDING_PREFIX}${randomUUID()}`);

    await this.ensureRoot();
    let published = false;
    try {
      await mkdir(pending, { mode: 0o700 });
      await writeFile(path.join(pending, METADATA_FILE), metadataBytes, { mode: 0o600, flag: 'wx' });
      await writeFile(path.join(pending, BYTES_FILE), byteSnapshot, { mode: 0o600, flag: 'wx' });
      if (!(await this.isAbsent(directory))) throw this.failed();
      await rename(pending, directory);
      published = true;
      return { asset: storedAsset, storage_key: assetId };
    } catch {
      if (!published) await this.cleanupPending(pending);
      throw this.failed();
    }
  }

  async readById(assetId: string): Promise<StoredAssetRead | null> {
    if (!isUuidV4(assetId)) return null;
    try {
      return await this.readAssetSafely(assetId);
    } catch {
      throw this.failed();
    }
  }

  async readByKey(key: string, options: { readonly signal: AbortSignal }): Promise<Blob> {
    const { signal } = options;
    if (signal.aborted) throw this.cancelled();
    if (!isUuidV4(key)) throw this.invalid();
    let read: StoredAssetRead | null;
    try {
      read = await this.readAssetSafely(key);
    } catch {
      if (signal.aborted) throw this.cancelled();
      throw this.failed();
    }
    if (signal.aborted) throw this.cancelled();
    if (read === null) throw makeRoundError('not_found', 'storage');
    return new Blob([new Uint8Array(read.bytes)], { type: read.asset.media_type });
  }

  private async readAssetSafely(assetId: string): Promise<StoredAssetRead | null> {
    const realRoot = await realpath(this.rootDirectory).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (realRoot === null) return null;

    const directory = path.join(this.rootDirectory, assetId);
    const entry = await lstat(directory).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (entry === null) return null;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw this.failed();

    const realDirectory = await realpath(directory).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (realDirectory === null) return null;
    if (
      path.basename(realDirectory) !== assetId
      || path.dirname(realDirectory) !== realRoot
    ) {
      throw this.failed();
    }

    const rawMetadata = await this.readCappedFile(
      path.join(directory, METADATA_FILE),
      realDirectory,
      MAX_METADATA_BYTES,
    );
    if (rawMetadata === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMetadata.toString('utf8'));
    } catch {
      throw this.failed();
    }
    const checked = validateAudioAsset(parsed);
    if (!checked.ok) throw this.failed();
    const value = checked.value;
    if (value.asset_id !== assetId) throw this.failed();

    const bytes = await this.readCappedFile(
      path.join(directory, BYTES_FILE),
      realDirectory,
      MAX_AUDIO_BYTES,
    );
    if (bytes === null) return null;

    const asset: AudioAsset = {
      asset_id: value.asset_id,
      media_type: value.media_type,
      duration_ms: value.duration_ms,
      sample_rate_hz: value.sample_rate_hz,
      channels: value.channels,
    };
    return { asset, bytes };
  }

  private async readCappedFile(
    filePath: string,
    realParent: string,
    maxBytes: number,
  ): Promise<Buffer | null> {
    const info = await lstat(filePath).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (info === null) return null;
    if (info.isSymbolicLink() || !info.isFile()) throw this.failed();

    const resolved = await realpath(filePath).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (resolved === null) return null;
    if (path.dirname(resolved) !== realParent) throw this.failed();

    const handle = await open(filePath, 'r').catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    if (handle === null) return null;

    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw this.failed();

      const buffer = Buffer.alloc(stat.size);
      let totalRead = 0;
      let iterations = 0;
      const maxIterations = stat.size;
      while (totalRead < stat.size) {
        if (++iterations > maxIterations) throw this.failed();
        const { bytesRead } = await handle.read(
          buffer,
          totalRead,
          stat.size - totalRead,
          totalRead,
        );
        if (bytesRead <= 0) throw this.failed();
        totalRead += bytesRead;
      }

      const finalStat = await handle.stat();
      if (finalStat.size !== stat.size) throw this.failed();

      if (totalRead > maxBytes) throw this.failed();
      return buffer;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private async isAbsent(target: string): Promise<boolean> {
    const found = await lstat(target).catch((error: unknown) => {
      if (codeOf(error) === 'ENOENT') return null;
      throw this.failed();
    });
    return found === null;
  }

  private async ensureRoot(): Promise<void> {
    try {
      await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    } catch {
      throw this.failed();
    }
  }

  private async cleanupPending(pending: string): Promise<void> {
    try {
      const info = await lstat(pending);
      if (info.isSymbolicLink() || !info.isDirectory()) return;
      const resolved = await realpath(pending);
      const realRoot = await realpath(this.rootDirectory);
      const dir = path.dirname(resolved);
      const base = path.basename(resolved);
      if (dir !== realRoot || !base.startsWith(PENDING_PREFIX)) return;
      await rm(resolved, { recursive: true, force: true });
    } catch {
      // Cleanup failure must never mask the original safe failure.
    }
  }

  private invalid(): Error {
    return makeRoundError('invalid_input', 'storage');
  }

  private failed(): Error {
    return makeRoundError('storage_failed', 'storage');
  }

  private cancelled(): Error {
    return makeRoundError('cancelled', 'storage');
  }
}
