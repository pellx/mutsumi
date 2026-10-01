/**
 * M03 - local NestJS bootstrap and safe transport boundary.
 *
 * This module owns exactly two things: composing a configured application
 * (`createApplication`) and, only when this compiled module is the direct entry
 * point, reading the allowlisted runtime environment and listening on loopback
 * (`bootstrap`). It never loads dotenv files, enumerates the environment, starts
 * cloud calls, or logs paths, keys, request data or foreign exception text.
 */
import 'reflect-metadata';

import {
  Catch,
  HttpException,
  NestFactory,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './api/app.module.ts';
import { makeRoundError, toRoundFailure } from './application/round-errors.ts';
import { createRuntime, type Runtime } from './application/runtime.ts';
import type {
  RoundFailure,
  RoundFailureCode,
  RuntimeMode,
} from './domain/conversation.ts';

const PRODUCT = 'mutsumi';
const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const JSON_BODY_LIMIT = '8kb';
const URLENCODED_BODY_LIMIT = '8kb';

/** No inline script/style, no eval, no CDN: only same-origin bundled assets. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** Static HTTP status for each owned failure code; anything else is 502. */
const FAILURE_STATUS: Readonly<Record<string, number>> = {
  invalid_input: 400,
  busy: 409,
  not_found: 404,
  provider_unavailable: 503,
  cancelled: 408,
  timed_out: 504,
  provider_failed: 502,
  invalid_result: 502,
  storage_failed: 500,
};

function applySecurityHeaders(res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}

/** Emit one static failure envelope; never a foreign message, path or URL. */
function sendFailure(res: Response, status: number, code: RoundFailureCode): void {
  if (res.headersSent) {
    return;
  }
  const failure: RoundFailure = toRoundFailure(makeRoundError(code, 'intake'), 'intake');
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ failure }));
}

/** Duplicated or unexpected header shapes return null instead of a value. */
function singleHeader(value: string | string[] | undefined): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
}

function isLoopbackHost(host: string, port: number): boolean {
  return host === `${LOOPBACK_HOST}:${port}` || host === `localhost:${port}`;
}

/**
 * Local-only transport guard. Runs before body parsers, static assets and
 * controllers: it pins the request to the actual bound loopback port, rejects
 * cross-site and non-matching browser origins, and adds hardening headers.
 */
function createTransportGuard(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    applySecurityHeaders(res);

    const localPort = req.socket.localPort;
    if (typeof localPort !== 'number' || !Number.isInteger(localPort)) {
      sendFailure(res, 403, 'invalid_input');
      return;
    }

    const host = singleHeader(req.headers.host);
    if (typeof host !== 'string' || !isLoopbackHost(host, localPort)) {
      sendFailure(res, 403, 'invalid_input');
      return;
    }

    const site = singleHeader(req.headers['sec-fetch-site']);
    if (site === null || (typeof site === 'string' && site.toLowerCase() === 'cross-site')) {
      sendFailure(res, 403, 'invalid_input');
      return;
    }

    const origin = singleHeader(req.headers.origin);
    if (origin !== undefined && (origin === null || origin !== `http://${host}`)) {
      sendFailure(res, 403, 'invalid_input');
      return;
    }

    next();
  };
}

/** Own integer status from a foreign error object; never reads its message. */
function numericStatusOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['status', 'statusCode']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    let candidate: unknown;
    try {
      candidate = record[key];
    } catch {
      return undefined;
    }
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function frameworkStatusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return Number.isInteger(status) ? status : undefined;
  }
  return numericStatusOf(exception);
}

type Outcome = { status: number; code: RoundFailureCode };

/**
 * Map a thrown value onto a static status and failure code. Framework statuses
 * become static client errors (parser rejections keep their 413), every other
 * value is reduced by the owned failure factory, which sanitises foreign errors.
 */
function outcomeOf(exception: unknown): Outcome {
  const frameworkStatus = frameworkStatusOf(exception);
  if (frameworkStatus === 413) {
    return { status: 413, code: 'invalid_input' };
  }
  if (frameworkStatus === 404) {
    return { status: 404, code: 'not_found' };
  }
  if (
    frameworkStatus !== undefined
    && frameworkStatus >= 400
    && frameworkStatus < 500
  ) {
    return { status: 400, code: 'invalid_input' };
  }
  const failure = toRoundFailure(exception, 'intake');
  return { status: FAILURE_STATUS[failure.code] ?? 502, code: failure.code };
}

@Catch()
export class RoundExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      return;
    }
    const outcome = outcomeOf(exception);
    sendFailure(res, outcome.status, outcome.code);
  }
}

/** Build the application without listening; callers own bind and shutdown. */
export async function createApplication(runtime: Runtime): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(runtime), {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });

  // 1. Transport guard and hardening headers, before any parser or route.
  app.use(createTransportGuard());
  // 2. Tiny structured-body parsers; the clip itself arrives as multipart.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: URLENCODED_BODY_LIMIT, extended: false });
  // 3. Only the configured public directory, without dotfiles or listing.
  app.useStaticAssets(runtime.webDirectory, {
    dotfiles: 'deny',
    index: 'index.html',
    redirect: false,
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res: Response): void => {
      applySecurityHeaders(res);
    },
  });
  app.useGlobalFilters(new RoundExceptionFilter());

  await app.init();
  return app;
}

type ServerConfig = {
  projectRoot: string;
  dataDirectory: string | undefined;
  mode: RuntimeMode;
  port: number;
  ffmpegBin: string | undefined;
  ffprobeBin: string | undefined;
  geminiApiKey: string | undefined;
  freeTierConfirmed: boolean;
};

/** Read one allowlisted variable; never enumerate the environment. */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readProjectRoot(): string {
  const configured = readEnv('MUTSUMI_PROJECT_ROOT');
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error('MUTSUMI_PROJECT_ROOT must be an absolute path.');
    }
    return configured;
  }
  // Compiled layout is <projectRoot>/dist/server/main.js.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function readMode(): RuntimeMode {
  const value = readEnv('MUTSUMI_MODE');
  if (value === undefined) {
    return 'live';
  }
  if (value === 'live' || value === 'development-mock') {
    return value;
  }
  throw new Error('MUTSUMI_MODE must be "live" or "development-mock".');
}

function readPort(): number {
  const value = readEnv('MUTSUMI_PORT');
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('MUTSUMI_PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

function readServerConfig(): ServerConfig {
  return {
    projectRoot: readProjectRoot(),
    dataDirectory: readEnv('MUTSUMI_DATA_DIR'),
    mode: readMode(),
    port: readPort(),
    ffmpegBin: readEnv('MUTSUMI_FFMPEG_BIN'),
    ffprobeBin: readEnv('MUTSUMI_FFPROBE_BIN'),
    geminiApiKey: readEnv('GEMINI_API_KEY'),
    freeTierConfirmed: readEnv('GEMINI_FREE_TIER_CONFIRMED') === 'true',
  };
}

/** Compose the runtime, bind loopback and install signal-driven shutdown. */
export async function bootstrap(): Promise<NestExpressApplication> {
  const config = readServerConfig();
  const runtime = createRuntime({
    projectRoot: config.projectRoot,
    dataDirectory: config.dataDirectory,
    mode: config.mode,
    geminiApiKey: config.geminiApiKey,
    freeTierConfirmed: config.freeTierConfirmed,
    ffmpegBin: config.ffmpegBin,
    ffprobeBin: config.ffprobeBin,
  });

  const app = await createApplication(runtime);
  const server = await app.listen(config.port, LOOPBACK_HOST);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  const shutdown = (): void => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  process.stdout.write(`${JSON.stringify({
    product: PRODUCT,
    mode: runtime.mode,
    url: `http://${LOOPBACK_HOST}:${config.port}`,
    providers: {
      analysis: runtime.health.analysis.status,
      dialogue: runtime.health.dialogue.status,
      synthesis: runtime.health.synthesis.status,
    },
  })}\n`);

  return app;
}

function isDirectEntry(entry: string | undefined): boolean {
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

// Importing this module (for example from tests) never starts a server or
// reads configuration; only a direct compiled entry does.
if (isDirectEntry(process.argv[1])) {
  void bootstrap().catch(() => {
    process.stderr.write('Mutsumi server failed to start.\n');
    process.exitCode = 1;
  });
}
