import { makeRoundError } from './round-errors.ts';

const MAX_INPUT = 1_048_576;
const MAX_CHUNKS = 64;
const MAX_FRAMES = 480_000;
const SENTINEL = 0xffff_ffff;
const HEADER_OUT = 44;

const TAG_RIFF = 0x5249_4646;
const TAG_WAVE = 0x5741_5645;
const TAG_FMT  = 0x666d_7420;
const TAG_DATA = 0x6461_7461;

function bad(): never {
  throw makeRoundError('invalid_input', 'intake');
}

export function normalizePcmWave(
  bytes: Uint8Array,
): { bytes: Uint8Array; duration_ms: number } {
  const len = bytes.byteLength;
  if (len > MAX_INPUT || len < 12) bad();

  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  if (view.getUint32(0) !== TAG_RIFF) bad();
  const riffSize = view.getUint32(4, true);
  if (riffSize !== len - 8 && riffSize !== SENTINEL) bad();
  if (view.getUint32(8) !== TAG_WAVE) bad();

  let off = 12;
  let hasFmt = false;
  let hasData = false;
  let pcmOff = 0;
  let pcmLen = 0;
  let n = 0;

  while (off < len) {
    if (++n > MAX_CHUNKS) bad();
    if (off + 8 > len) bad();
    if (hasData) bad();

    const id = view.getUint32(off);
    const sz = view.getUint32(off + 4, true);

    if (id === TAG_FMT) {
      if (hasFmt) bad();
      hasFmt = true;
      if (sz < 16 || sz > 40) bad();
      if (off + 8 + sz > len) bad();
      const d = off + 8;
      if (view.getUint16(d, true) !== 1) bad();
      if (view.getUint16(d + 2, true) !== 1) bad();
      if (view.getUint32(d + 4, true) !== 16000) bad();
      if (view.getUint32(d + 8, true) !== 32000) bad();
      if (view.getUint16(d + 12, true) !== 2) bad();
      if (view.getUint16(d + 14, true) !== 16) bad();
      off += 8 + sz + (sz & 1);
    } else if (id === TAG_DATA) {
      if (!hasFmt) bad();
      hasData = true;
      if (sz === SENTINEL) {
        pcmOff = off + 8;
        pcmLen = len - pcmOff;
      } else {
        if (sz <= 0) bad();
        if (off + 8 + sz > len) bad();
        pcmOff = off + 8;
        pcmLen = sz;
      }
      if (pcmLen <= 0 || (pcmLen & 1) !== 0) bad();
      if (pcmLen / 2 > MAX_FRAMES) bad();
      off = pcmOff + pcmLen;
    } else {
      if (sz === SENTINEL) bad();
      if (off + 8 + sz > len) bad();
      off += 8 + sz + (sz & 1);
    }
  }

  if (!hasFmt || !hasData) bad();

  const total = HEADER_OUT + pcmLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);

  dv.setUint32(0, TAG_RIFF);
  dv.setUint32(4, total - 8, true);
  dv.setUint32(8, TAG_WAVE);
  dv.setUint32(12, TAG_FMT);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, TAG_DATA);
  dv.setUint32(40, pcmLen, true);

  out.set(bytes.subarray(pcmOff, pcmOff + pcmLen), HEADER_OUT);

  const duration_ms = Math.ceil((pcmLen / 2) / 16000 * 1000);
  return { bytes: out, duration_ms };
}
