/**
 * M03 - private local conversation store adapter.
 *
 * Persists validated TurnRecords plus shared owner configuration beneath a
 * trusted, server-configured root that composition places under the ignored
 * data/ tree. Nothing here is a provider adapter: no cloud call, credential,
 * dialogue or synthesis logic. Records are stored honestly as partial or
 * complete results, and assistant audio only counts as heard after
 * markPlaybackCompleted records it explicitly.
 *
 * Boundaries:
 * - Only the two canonical local owner sessions (`owner-live` and
 *   `owner-development-mock`) own turn records; conversations never cross
 *   modes, while explicit owner preferences are shared.
 * - Owner configuration is read-only here: a missing persona.json or
 *   preferences.json yields the neutral default persona and empty preferences,
 *   and a corrupt one fails honestly instead of being rewritten or invented.
 * - Every path is rooted and bounded: symlinked owned directories and files are
 *   rejected, resolved parents are verified against the configured root, and
 *   directory entry counts, file sizes and history limits are capped.
 * - All operation failures are factory-owned static round errors at the storage
 *   stage; no path, parser text or IO message escapes to the caller.
 * - Trusted local filesystem ownership is assumed; this adapter does not claim
 *   immunity to external concurrent path substitution.
 * - Permission modes 0600/0700 are requested where the platform applies them;
 *   no encryption or ACL guarantee is claimed.
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { validatePersona, validatePreferences } from '../domain/conversation-validation.ts';
import { validateTurnRecord } from '../domain/turn-record-validation.ts';
import type {
  HistoryTurn,
  OwnerPreference,
  Persona,
  RuntimeMode,
  TurnRecord,
} from '../domain/conversation.ts';
import type { ConversationStorePort } from '../application/conversation-ports.ts';
import { makeRoundError, toRoundFailure } from '../application/round-errors.ts';

type OwnerSessionId = 'owner-live' | 'owner-development-mock';

const OWNER_SESSION_IDS: readonly string[] = ['owner-live', 'owner-development-mock'];
const TURNS_DIRECTORY = 'turns';
const PERSONA_FILE = 'persona.json';
const PREFERENCES_FILE = 'preferences.json';
const PENDING_PREFIX = '.pending-';
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_BYTES = 32_768;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_HISTORY_LIMIT = 100;
const MAX_CREATED_AT_MS = 9_999_999_999_999_999;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_FILE_PATTERN =
  /^[0-9]{16}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isEnoent(error: unknown): boolean {
  return codeOf(error) === 'ENOENT';
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isOwnerSession(value: unknown): value is OwnerSessionId {
  return typeof value === 'string' && OWNER_SESSION_IDS.includes(value);
}

/** The single runtime mode each canonical owner session may record. */
function expectedModeForSession(session: OwnerSessionId): RuntimeMode {
  return session === 'owner-live' ? 'live' : 'development-mock';
}

function recordFileName(record: TurnRecord): string {
  return `${String(record.created_at_ms).padStart(16, '0')}_${record.turn_id}.json`;
}

function defaultPersona(): Persona {
  return { persona_id: 'mutsumi', name: 'mutsumi', instructions: [] };
}

export class FileConversationStore implements ConversationStorePort {
  readonly rootDirectory: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { rootDirectory: string }) {
    const root = options.rootDirectory;
    if (typeof root !== 'string' || root.length === 0 || path.isAbsolute(root) === false) {
      throw makeRoundError('invalid_input', 'storage');
    }
    this.rootDirectory = path.resolve(root);
  }

  async loadPersona(): Promise<Persona> {
    return this.guard(async () => {
      const bytes = await this.readConfigBytes(PERSONA_FILE);
      if (bytes === null) return defaultPersona();
      const checked = validatePersona(this.parseJsonBytes(bytes));
      if (checked.ok === false) throw this.failed();
      return structuredClone(checked.value);
    });
  }

  async loadPreferences(sessionId: string): Promise<OwnerPreference[]> {
    if (isOwnerSession(sessionId) === false) return [];
    return this.guard(async () => {
      const bytes = await this.readConfigBytes(PREFERENCES_FILE);
      if (bytes === null) return [];
      const checked = validatePreferences(this.parseJsonBytes(bytes));
      if (checked.ok === false) throw this.failed();
      return structuredClone(checked.value);
    });
  }

  async recentHistory(sessionId: string, limit: number): Promise<HistoryTurn[]> {
    if (isOwnerSession(sessionId) === false) return [];
    if (Number.isInteger(limit) === false || limit < 0 || limit > MAX_HISTORY_LIMIT) {
      throw this.invalidInput();
    }
    if (limit === 0) return [];
    return this.guard(async () => {
      const directory = await this.resolveSessionDirectory(sessionId);
      if (directory === null) return [];
      const names = await this.listRecordNames(directory);
      const selected = names.slice(Math.max(0, names.length - limit));
      const history: HistoryTurn[] = [];
      for (const name of selected) {
        const record = await this.readRecord(directory, sessionId, name);
        history.push({
          turn_id: record.turn_id,
          user_text: record.annotation?.transcript ?? '',
          assistant_text: record.reply_draft?.reply_text ?? null,
          assistant_playback_completed: record.playback_completed,
        });
      }
      return history;
    });
  }

  async saveTurn(turn: TurnRecord): Promise<void> {
    const checked = validateTurnRecord(turn);
    if (checked.ok === false) throw this.invalidInput();
    const record = structuredClone(checked.value);
    if (isOwnerSession(record.session_id) === false) throw this.invalidInput();
    const sessionId = record.session_id;
    if (record.mode !== expectedModeForSession(sessionId)) throw this.invalidInput();
    if (isUuidV4(record.turn_id) === false) throw this.invalidInput();
    if (record.created_at_ms > MAX_CREATED_AT_MS) throw this.invalidInput();
    return this.enqueue(() =>
      this.guard(async () => {
        const directory = await this.ensureSessionDirectory(sessionId);
        const suffix = `_${record.turn_id}.json`;
        const existing = await this.listRecordNames(directory);
        if (existing.some((name) => name.endsWith(suffix))) throw this.invalidInput();
        await this.writeRecord(record, directory, recordFileName(record), false);
      }),
    );
  }

  async getTurn(sessionId: string, turnId: string): Promise<TurnRecord | null> {
    if (isOwnerSession(sessionId) === false) return null;
    if (isUuidV4(turnId) === false) return null;
    return this.guard(async () => {
      const directory = await this.resolveSessionDirectory(sessionId);
      if (directory === null) return null;
      const suffix = `_${turnId}.json`;
      const names = await this.listRecordNames(directory);
      const name = names.find((candidate) => candidate.endsWith(suffix));
      if (name === undefined) return null;
      return this.readRecord(directory, sessionId, name);
    });
  }

  async markPlaybackCompleted(sessionId: string, turnId: string): Promise<TurnRecord> {
    return this.enqueue(() =>
      this.guard(async () => {
        if (isOwnerSession(sessionId) === false) throw this.invalidInput();
        if (isUuidV4(turnId) === false) throw this.invalidInput();
        const directory = await this.resolveSessionDirectory(sessionId);
        if (directory === null) throw this.notFound();
        const suffix = `_${turnId}.json`;
        const names = await this.listRecordNames(directory);
        const name = names.find((candidate) => candidate.endsWith(suffix));
        if (name === undefined) throw this.notFound();
        const record = await this.readRecord(directory, sessionId, name);
        if (record.playback_completed) return record;
        if (record.output_asset === null || record.reply_draft === null) throw this.invalidInput();
        const updated: TurnRecord = structuredClone(record);
        updated.playback_completed = true;
        const checked = validateTurnRecord(updated);
        if (checked.ok === false) throw this.invalidInput();
        await this.writeRecord(checked.value, directory, name, true);
        return structuredClone(checked.value);
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Rooted path resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve an owned directory to its real path; `null` when it does not exist.
   * A symlink, a non-directory, or a resolved path that is not exactly the
   * expected base beneath the configured parent is an honest failure.
   */
  private async resolveOwnedDirectory(
    absolutePath: string,
    parentReal: string | null,
    expectedBase: string,
  ): Promise<string | null> {
    const info = await lstat(absolutePath).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    if (info === null) return null;
    if (info.isSymbolicLink() || info.isDirectory() === false) throw this.failed();
    const resolved = await realpath(absolutePath).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    if (resolved === null) return null;
    if (path.basename(resolved) !== expectedBase) throw this.failed();
    if (parentReal !== null && path.dirname(resolved) !== parentReal) throw this.failed();
    return resolved;
  }

  private async resolveRootDirectory(): Promise<string | null> {
    return this.resolveOwnedDirectory(this.rootDirectory, null, path.basename(this.rootDirectory));
  }

  private async resolveSessionDirectory(sessionId: OwnerSessionId): Promise<string | null> {
    const rootReal = await this.resolveRootDirectory();
    if (rootReal === null) return null;
    const realTurns = await this.resolveOwnedDirectory(
      path.join(rootReal, TURNS_DIRECTORY),
      rootReal,
      TURNS_DIRECTORY,
    );
    if (realTurns === null) return null;
    return this.resolveOwnedDirectory(path.join(realTurns, sessionId), realTurns, sessionId);
  }

  /** Create the root and the owned session directory tree for the first save. */
  private async ensureSessionDirectory(sessionId: OwnerSessionId): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 }).catch(() => {
      throw this.failed();
    });
    const rootReal = await this.resolveRootDirectory();
    if (rootReal === null) throw this.failed();
    const turnsPath = path.join(rootReal, TURNS_DIRECTORY);
    await mkdir(turnsPath, { recursive: true, mode: 0o700 }).catch(() => {
      throw this.failed();
    });
    const realTurns = await this.resolveOwnedDirectory(turnsPath, rootReal, TURNS_DIRECTORY);
    if (realTurns === null) throw this.failed();
    const sessionPath = path.join(realTurns, sessionId);
    await mkdir(sessionPath, { recursive: true, mode: 0o700 }).catch(() => {
      throw this.failed();
    });
    const realSession = await this.resolveOwnedDirectory(sessionPath, realTurns, sessionId);
    if (realSession === null) throw this.failed();
    return realSession;
  }

  // -------------------------------------------------------------------------
  // Bounded reads
  // -------------------------------------------------------------------------

  /** Sorted canonical record filenames; pending and unrelated names are ignored. */
  private async listRecordNames(directory: string): Promise<string[]> {
    const entries = await readdir(directory).catch(() => {
      throw this.failed();
    });
    if (entries.length > MAX_DIRECTORY_ENTRIES) throw this.failed();
    const names: string[] = [];
    for (const entry of entries) {
      if (RECORD_FILE_PATTERN.test(entry) === false) continue;
      const info = await lstat(path.join(directory, entry)).catch((error: unknown) => {
        if (isEnoent(error)) return null;
        throw this.failed();
      });
      if (info === null || info.isSymbolicLink() || info.isFile() === false) throw this.failed();
      names.push(entry);
    }
    names.sort();
    return names;
  }

  private async readConfigBytes(fileName: string): Promise<Uint8Array | null> {
    const rootReal = await this.resolveRootDirectory();
    if (rootReal === null) return null;
    return this.readCappedFile(path.join(rootReal, fileName), rootReal, MAX_CONFIG_BYTES);
  }

  private async readRecord(
    directory: string,
    sessionId: OwnerSessionId,
    name: string,
  ): Promise<TurnRecord> {
    const bytes = await this.readCappedFile(path.join(directory, name), directory, MAX_RECORD_BYTES);
    if (bytes === null) throw this.failed();
    const checked = validateTurnRecord(this.parseJsonBytes(bytes));
    if (checked.ok === false) throw this.failed();
    const record = checked.value;
    if (record.session_id !== sessionId) throw this.failed();
    if (record.mode !== expectedModeForSession(sessionId)) throw this.failed();
    if (recordFileName(record) !== name) throw this.failed();
    return record;
  }

  /**
   * Read a bounded regular file: reject symlinks, verify the resolved parent,
   * size the buffer before allocating, loop over short reads, and reject a file
   * that grew, shrank or was removed while reading. Handles are always closed.
   */
  private async readCappedFile(
    filePath: string,
    parentReal: string,
    maxBytes: number,
  ): Promise<Uint8Array | null> {
    const info = await lstat(filePath).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    if (info === null) return null;
    if (info.isSymbolicLink() || info.isFile() === false) throw this.failed();
    const resolved = await realpath(filePath).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    if (resolved === null) return null;
    if (path.dirname(resolved) !== parentReal) throw this.failed();

    const handle = await open(filePath, 'r').catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    if (handle === null) return null;
    try {
      const stat = await handle.stat();
      if (stat.isFile() === false || stat.size <= 0 || stat.size > maxBytes) throw this.failed();
      const buffer = Buffer.alloc(stat.size);
      let totalRead = 0;
      let iterations = 0;
      while (totalRead < stat.size) {
        if (++iterations > stat.size) throw this.failed();
        const { bytesRead } = await handle.read(buffer, totalRead, stat.size - totalRead, totalRead);
        if (bytesRead <= 0) throw this.failed();
        totalRead += bytesRead;
      }
      const finalStat = await handle.stat();
      if (finalStat.size !== stat.size) throw this.failed();
      return buffer;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private parseJsonBytes(bytes: Uint8Array): unknown {
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
      throw this.failed();
    }
  }

  // -------------------------------------------------------------------------
  // Atomic, exclusive writes
  // -------------------------------------------------------------------------

  /**
   * Write one record through an exclusive private pending file and an atomic
   * rename. Existing history is never overwritten unless `replaceExisting` is
   * set for the same record path by markPlaybackCompleted.
   */
  private async writeRecord(
    record: TurnRecord,
    directory: string,
    name: string,
    replaceExisting: boolean,
  ): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(record), 'utf8');
    if (bytes.byteLength > MAX_RECORD_BYTES) throw this.invalidInput();
    const pendingPath = path.join(directory, `${PENDING_PREFIX}${randomUUID()}`);
    const targetPath = path.join(directory, name);
    let pendingCreated = false;
    try {
      await writeFile(pendingPath, bytes, { mode: 0o600, flag: 'wx' });
      pendingCreated = true;
      if (replaceExisting === false && (await this.isAbsent(targetPath)) === false) {
        throw this.invalidInput();
      }
      await rename(pendingPath, targetPath);
      pendingCreated = false;
    } finally {
      if (pendingCreated) await this.cleanupPending(pendingPath, directory);
    }
  }

  private async isAbsent(target: string): Promise<boolean> {
    const found = await lstat(target).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw this.failed();
    });
    return found === null;
  }

  /** Remove only this operation's own pending file; never a directory or a tree. */
  private async cleanupPending(pendingPath: string, parentReal: string): Promise<void> {
    try {
      const info = await lstat(pendingPath);
      if (info.isSymbolicLink() || info.isFile() === false) return;
      const resolved = await realpath(pendingPath);
      const base = path.basename(resolved);
      if (path.dirname(resolved) !== parentReal || base.startsWith(PENDING_PREFIX) === false) return;
      await rm(resolved);
    } catch {
      // Cleanup failure must never mask the original safe failure.
    }
  }

  // -------------------------------------------------------------------------
  // Serialized mutations and safe errors
  // -------------------------------------------------------------------------

  /** Serialize mutations; the queue always recovers after a rejected operation. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async guard<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error: unknown) {
      throw this.safeError(error);
    }
  }

  /** Preserve a trusted round-error code; every foreign failure becomes storage_failed. */
  private safeError(error: unknown): Error {
    const failure = toRoundFailure(error, 'storage');
    const code = failure.code === 'provider_failed' ? 'storage_failed' : failure.code;
    return makeRoundError(code, 'storage');
  }

  private invalidInput(): Error {
    return makeRoundError('invalid_input', 'storage');
  }

  private notFound(): Error {
    return makeRoundError('not_found', 'storage');
  }

  private failed(): Error {
    return makeRoundError('storage_failed', 'storage');
  }
}
