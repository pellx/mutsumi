/**
 * M03 - NestJS HTTP transport for the complete-round runtime.
 *
 * Thin transport: each route validates its own request shape, calls exactly one
 * approved application or storage port and serializes a domain result. No vendor
 * SDK, raw provider payload, storage key, filesystem path, credential or cloud
 * call appears here, and no retry is attempted. Every async storage read or write
 * is bounded to two seconds with timer cleanup, and an abandoned settlement keeps
 * its rejection handler so it can never become an unhandled rejection. Only errors
 * created by makeRoundError leave this controller, so the global filter maps one
 * safe status per failure code.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { RUNTIME_TOKEN } from '../application/runtime.ts';
import type { Runtime, RuntimeHealth } from '../application/runtime.ts';
import { makeRoundError, toRoundFailure } from '../application/round-errors.ts';
import type { RoundJob } from '../application/round-service.ts';
import type { AudioAsset } from '../domain/annotation.ts';
import type { RoundStage, RuntimeMode, TurnRecord } from '../domain/conversation.ts';

/** Multer's in-memory file; only the bytes and the declared media type are read. */
type UploadedAudioFile = { buffer?: unknown; mimetype?: unknown };

type SessionInfo = { session_id: string; mode: RuntimeMode };

type ParsedRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const MAX_AUDIO_BYTES = 10_485_760;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const MAX_MEDIA_TYPE_LENGTH = 128;
const HTTP_BOUND_MS = 2_000;
const RANGE_UNIT = 'bytes=';
const DIGITS_PATTERN = /^[0-9]+$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RANGE_UNSATISFIABLE_BODY =
  '{"status":416,"code":"range_not_satisfiable",'
  + '"message":"The requested byte range is not satisfiable."}';

/** Reduce any thrown value to a trusted RoundError that keeps only its safe code. */
function toOwnedRoundError(error: unknown, stage: RoundStage): Error {
  const failure = toRoundFailure(error, stage);
  return makeRoundError(failure.code, stage);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.getOwnPropertySymbols(value).length === 0;
}

/** Accept only an absent body or an empty plain object; anything else is invalid. */
function assertEmptyBody(body: unknown): void {
  if (body === undefined) return;
  if (!isPlainRecord(body) || Object.getOwnPropertyNames(body).length > 0) {
    throw makeRoundError('invalid_input', 'intake');
  }
}

/** The multipart body must carry exactly one non-empty `client_request_id` field. */
function readClientRequestId(body: unknown): string {
  if (!isPlainRecord(body)) throw makeRoundError('invalid_input', 'intake');
  const names = Object.getOwnPropertyNames(body);
  if (names.length !== 1 || names[0] !== 'client_request_id') {
    throw makeRoundError('invalid_input', 'intake');
  }
  const value: unknown = body['client_request_id'];
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_CLIENT_REQUEST_ID_LENGTH
  ) {
    throw makeRoundError('invalid_input', 'intake');
  }
  return value;
}

/** Validate the uploaded bytes and declared media type; never trust a filename. */
function readUploadedAudio(
  file: UploadedAudioFile | undefined,
): { bytes: Uint8Array; declared_media_type: string } {
  if (file === undefined || file === null) throw makeRoundError('invalid_input', 'intake');
  const bytes = file.buffer;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_AUDIO_BYTES) {
    throw makeRoundError('invalid_input', 'intake');
  }
  const declared = file.mimetype;
  if (
    typeof declared !== 'string'
    || declared.length < 1
    || declared.length > MAX_MEDIA_TYPE_LENGTH
  ) {
    throw makeRoundError('invalid_input', 'intake');
  }
  return { bytes, declared_media_type: declared };
}

function readRangeHeader(request: Request): string | undefined {
  const value: unknown = request.headers.range;
  return typeof value === 'string' ? value : undefined;
}

/** Accept one bounded `bytes=` range; multi-range, reversed or out-of-bounds is 416. */
function parseSingleRange(raw: string | undefined, length: number): ParsedRange {
  if (raw === undefined) return { kind: 'full' };
  const value = raw.trim();
  if (length < 1 || !value.startsWith(RANGE_UNIT)) return { kind: 'unsatisfiable' };
  const spec = value.slice(RANGE_UNIT.length);
  if (spec.length === 0 || spec.includes(',')) return { kind: 'unsatisfiable' };
  const dash = spec.indexOf('-');
  if (dash < 0) return { kind: 'unsatisfiable' };
  const startPart = spec.slice(0, dash);
  const endPart = spec.slice(dash + 1);
  const startBlank = startPart === '';
  const endBlank = endPart === '';
  if (startBlank && endBlank) return { kind: 'unsatisfiable' };
  if (!startBlank && !DIGITS_PATTERN.test(startPart)) return { kind: 'unsatisfiable' };
  if (!endBlank && !DIGITS_PATTERN.test(endPart)) return { kind: 'unsatisfiable' };
  if (startBlank) {
    const suffix = Number(endPart);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(startPart);
  if (!Number.isSafeInteger(start) || start >= length) return { kind: 'unsatisfiable' };
  if (endBlank) return { kind: 'partial', start, end: length - 1 };
  const end = Number(endPart);
  if (!Number.isSafeInteger(end) || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, length - 1) };
}

/** Native Uint8Array to Buffer, respecting the view's own offset and length. */
function byteView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

@Controller('api')
export class RoundsController {
  private readonly runtime: Runtime;

  constructor(@Inject(RUNTIME_TOKEN) runtime: Runtime) {
    this.runtime = runtime;
  }

  /** Cloned runtime capability summary; no credential, key or path is exposed. */
  @Get('health')
  health(): RuntimeHealth {
    return structuredClone(this.runtime.health);
  }

  /** The single fixed session; no arbitrary session can be created over HTTP. */
  @Post('sessions')
  @HttpCode(201)
  createSession(@Body() body: unknown): SessionInfo {
    assertEmptyBody(body);
    return { session_id: this.runtime.sessionId, mode: this.runtime.mode };
  }

  /**
   * Submit one complete clip exactly once. The path session must be the runtime
   * session, and the multipart body must carry only `client_request_id` plus the
   * single in-memory `audio` part.
   */
  @Post('sessions/:sessionId/turns')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('audio', {
    limits: {
      fileSize: MAX_AUDIO_BYTES,
      files: 1,
      fields: 1,
      fieldSize: MAX_CLIENT_REQUEST_ID_LENGTH,
      parts: 2,
    },
  }))
  submitTurn(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedAudioFile | undefined,
  ): RoundJob {
    if (sessionId !== this.runtime.sessionId) throw makeRoundError('invalid_input', 'intake');
    const clientRequestId = readClientRequestId(body);
    const upload = readUploadedAudio(file);
    try {
      return this.runtime.rounds.submit({
        session_id: this.runtime.sessionId,
        client_request_id: clientRequestId,
        submission: { bytes: upload.bytes, declared_media_type: upload.declared_media_type },
      });
    } catch (error) {
      throw toOwnedRoundError(error, 'intake');
    }
  }

  /** Poll one status snapshot; an unknown or foreign-session job is not_found. */
  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string): RoundJob {
    return this.requireJob(jobId);
  }

  /** Read one persisted turn for this session; an unknown turn is not_found. */
  @Get('sessions/:sessionId/turns/:turnId')
  async getTurn(
    @Param('sessionId') sessionId: string,
    @Param('turnId') turnId: string,
  ): Promise<TurnRecord> {
    this.requireSession(sessionId);
    const record = await this.bounded(
      () => this.runtime.rounds.getTurn(sessionId, turnId),
      'storage',
    );
    if (record === null) throw makeRoundError('not_found', 'storage');
    return record;
  }

  /**
   * Record that the browser actually finished playback. The server never marks
   * playback on its own, so the client must send this after the audio ends.
   */
  @Post('sessions/:sessionId/turns/:turnId/playback-completed')
  async markPlaybackCompleted(
    @Param('sessionId') sessionId: string,
    @Param('turnId') turnId: string,
    @Body() body: unknown,
  ): Promise<TurnRecord> {
    this.requireSession(sessionId);
    assertEmptyBody(body);
    return this.bounded(
      () => this.runtime.rounds.markPlaybackCompleted(sessionId, turnId),
      'storage',
    );
  }

  /** Stream one asset linked to a job record; no arbitrary key or path is served. */
  @Get('jobs/:jobId/audio/:assetId')
  async getJobAudio(
    @Param('jobId') jobId: string,
    @Param('assetId') assetId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    const linked = this.linkedAsset(job.record, assetId);
    await this.sendAsset(response, linked, assetId, readRangeHeader(request));
  }

  /** Stream one asset linked to a persisted turn record for this session. */
  @Get('sessions/:sessionId/turns/:turnId/audio/:assetId')
  async getTurnAudio(
    @Param('sessionId') sessionId: string,
    @Param('turnId') turnId: string,
    @Param('assetId') assetId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.requireSession(sessionId);
    const record = await this.bounded(
      () => this.runtime.rounds.getTurn(sessionId, turnId),
      'storage',
    );
    if (record === null) throw makeRoundError('not_found', 'storage');
    const linked = this.linkedAsset(record, assetId);
    await this.sendAsset(response, linked, assetId, readRangeHeader(request));
  }

  // -- internals ------------------------------------------------------------

  private requireJob(jobId: string): RoundJob {
    const job = this.runtime.rounds.getJob(jobId);
    if (
      job === null
      || job.mode !== this.runtime.mode
      || job.session_id !== this.runtime.sessionId
    ) {
      throw makeRoundError('not_found', 'intake');
    }
    return job;
  }

  /** Reject any foreign session before a persistence call and hide it uniformly. */
  private requireSession(sessionId: string): void {
    if (sessionId !== this.runtime.sessionId) {
      throw makeRoundError('not_found', 'storage');
    }
  }

  /** Only an asset id already linked by the record may be served. */
  private linkedAsset(record: TurnRecord | null, assetId: string): AudioAsset {
    if (record === null || !UUID_V4_PATTERN.test(assetId)) {
      throw makeRoundError('not_found', 'storage');
    }
    const candidates: readonly (AudioAsset | null)[] = [
      record.source_asset,
      record.input_asset,
      record.output_asset,
    ];
    for (const candidate of candidates) {
      if (candidate !== null && candidate.asset_id === assetId) return candidate;
    }
    throw makeRoundError('not_found', 'storage');
  }

  private async sendAsset(
    response: Response,
    linked: AudioAsset,
    assetId: string,
    range: string | undefined,
  ): Promise<void> {
    const read = await this.bounded(
      () => this.runtime.audioStorage.readById(assetId),
      'storage',
    );
    if (read === null) throw makeRoundError('not_found', 'storage');
    if (
      read.asset.asset_id !== linked.asset_id
      || read.asset.media_type !== linked.media_type
      || read.asset.duration_ms !== linked.duration_ms
      || read.asset.sample_rate_hz !== linked.sample_rate_hz
      || read.asset.channels !== linked.channels
    ) {
      throw makeRoundError('invalid_result', 'storage');
    }
    const bytes = byteView(read.bytes);
    const length = bytes.byteLength;
    const parsed = parseSingleRange(range, length);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (parsed.kind === 'unsatisfiable') {
      const body = Buffer.from(RANGE_UNSATISFIABLE_BODY, 'utf8');
      response.status(416);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Range', `bytes */${length}`);
      response.setHeader('Content-Length', String(body.byteLength));
      response.end(body);
      return;
    }
    response.setHeader('Content-Type', read.asset.media_type);
    if (parsed.kind === 'partial') {
      const slice = bytes.subarray(parsed.start, parsed.end + 1);
      response.status(206);
      response.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${length}`);
      response.setHeader('Content-Length', String(slice.byteLength));
      response.end(slice);
      return;
    }
    response.status(200);
    response.setHeader('Content-Length', String(length));
    response.end(bytes);
  }

  /**
   * Bound one port call to two seconds. Timer cleanup runs on either settlement,
   * the abandoned promise keeps its rejection handler and there is no retry.
   */
  private bounded<T>(operation: () => Promise<T>, stage: RoundStage): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle();
      };
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        finish(() => reject(makeRoundError('timed_out', stage)));
      }, HTTP_BOUND_MS);
      let pending: Promise<T>;
      try {
        pending = operation();
      } catch (error) {
        finish(() => reject(toOwnedRoundError(error, stage)));
        return;
      }
      pending.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(toOwnedRoundError(error, stage))),
      );
    });
  }
}
