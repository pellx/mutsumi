import { spawn } from 'node:child_process';
import { makeRoundError } from './round-errors.ts';

const MAX_STR = 4096;
const MAX_ARG_COUNT = 64;
const TIMEOUT_MIN = 1;
const TIMEOUT_MAX = 30_000;
const OUT_MIN = 1;
const OUT_MAX = 2 * 1024 * 1024;
const STDERR_CAP = 64 * 1024;
const GRACE_MS = 1_000;

const ENV_KEYS: readonly string[] = [
  'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT', 'LANG', 'LC_ALL',
];

type Options = {
  executable: string;
  args: string[];
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
};

type KillReason = 'cancelled' | 'timed_out' | 'invalid_input';

function invalid(): never { throw makeRoundError('invalid_input', 'intake'); }

function badStr(s: unknown, max: number): boolean {
  return typeof s !== 'string' || s.length === 0 || s.length > max
    || s.includes('\u0000');
}

function assertValid(o: Options): void {
  if (badStr(o.executable, MAX_STR)) invalid();
  if (!Array.isArray(o.args) || o.args.length > MAX_ARG_COUNT) invalid();
  for (const a of o.args) if (badStr(a, MAX_STR)) invalid();
  if (!Number.isSafeInteger(o.timeoutMs)
    || o.timeoutMs < TIMEOUT_MIN || o.timeoutMs > TIMEOUT_MAX) invalid();
  if (!Number.isSafeInteger(o.maxOutputBytes)
    || o.maxOutputBytes < OUT_MIN || o.maxOutputBytes > OUT_MAX) invalid();
}

function safeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export async function runAudioTool(options: Options): Promise<Uint8Array> {
  assertValid(options);
  if (options.signal.aborted) throw makeRoundError('cancelled', 'intake');

  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    let killReason: KillReason | undefined;
    const chunks: Buffer[] = [];
    let outTotal = 0;
    let errTotal = 0;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let graceId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timerId !== undefined) clearTimeout(timerId);
      if (graceId !== undefined) clearTimeout(graceId);
      options.signal.removeEventListener('abort', onAbort);
    };

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const requestKill = (reason: KillReason): void => {
      if (settled || killReason) return;
      killReason = reason;
      try { child.kill(); } catch { /* already exited */ }
      graceId = setTimeout(() => {
        finish(() => reject(makeRoundError(reason, 'intake')));
      }, GRACE_MS);
    };

    const onAbort = (): void => { requestKill('cancelled'); };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.executable, options.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: safeEnv(),
      });
    } catch {
      finish(() => reject(makeRoundError('provider_unavailable', 'intake')));
      return;
    }

    child.on('error', (): void => {
      if (killReason || settled) return;
      try { child.kill(); } catch { /* noop */ }
      finish(() => reject(makeRoundError('provider_unavailable', 'intake')));
    });

    timerId = setTimeout(() => { requestKill('timed_out'); }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort);

    child.stdout!.on('data', (chunk: Buffer): void => {
      outTotal += chunk.length;
      if (outTotal > options.maxOutputBytes) { requestKill('invalid_input'); return; }
      chunks.push(chunk);
    });

    child.stderr!.on('data', (chunk: Buffer): void => {
      errTotal += chunk.length;
      if (errTotal > STDERR_CAP) requestKill('invalid_input');
    });

    child.on('close', (code: number | null): void => {
      if (killReason) {
        finish(() => reject(makeRoundError(killReason, 'intake')));
        return;
      }
      if (code === 0) {
        const merged = Buffer.concat(chunks);
        finish(() => { resolve(new Uint8Array(merged)); });
      } else {
        finish(() => reject(makeRoundError('invalid_input', 'intake')));
      }
    });
  });
}