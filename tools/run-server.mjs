// Supervisor launcher: parse allowlisted settings as data; never select coding keys.
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const modeArg = args.find(arg => arg.startsWith('--mode='));
const mode = modeArg?.slice(7) || 'live';
const check = args.includes('--check');
if (args.some(arg => arg !== '--check' && arg !== modeArg) ||
    !['live', 'development-mock'].includes(mode)) {
  console.error('Invalid launcher arguments.'); process.exit(1);
}
const commonNames = ['MUTSUMI_DATA_DIR', 'MUTSUMI_PORT', 'MUTSUMI_FFMPEG_BIN', 'MUTSUMI_FFPROBE_BIN'];
const googleNames = ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL', 'GEMINI_FREE_TIER_CONFIRMED', 'GEMINI_PROXY_URL'];
const allowed = new Set(mode === 'live' ? [...commonNames, ...googleNames] : commonNames);
const settings = Object.create(null);

async function launch() {
  let source = '';
  try {
    const info = await stat(path.join(root, '.env'));
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid configuration.');
    source = await readFile(path.join(root, '.env'), 'utf8');
    if (Buffer.byteLength(source, 'utf8') > 65536) throw new Error('Invalid configuration.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Cannot read local configuration.');
  }
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !allowed.has(match[1])) continue;
    if (Object.hasOwn(settings, match[1])) throw new Error('Duplicate runtime setting.');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.length > 4096 || /[\r\n]/.test(value) ||
        [...value].some(character => character.charCodeAt(0) === 0)) throw new Error('Invalid runtime setting.');
    settings[match[1]] = value;
  }
  source = '';
  const port = settings.MUTSUMI_PORT || '3000';
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Invalid local port.');
  const freeFlag = settings.GEMINI_FREE_TIER_CONFIRMED || '';
  if (!['', 'false', 'true'].includes(freeFlag)) throw new Error('Invalid free-tier confirmation.');
  const confirmed = mode === 'live' && freeFlag === 'true';
  if (mode === 'live') {
    const endpoint = new URL(settings.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com');
    if (endpoint.href !== 'https://generativelanguage.googleapis.com/' ||
        (settings.GEMINI_MODEL && settings.GEMINI_MODEL !== 'gemini-3.8-flash')) {
      throw new Error('Only the selected official Gemini service is configured.');
    }
  }
  let proxy = null;
  if (mode === 'live' && settings.GEMINI_PROXY_URL) {
    proxy = new URL(settings.GEMINI_PROXY_URL);
    if (proxy.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname) ||
        proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname !== '/') {
      throw new Error('Proxy must be an explicit local HTTP address.');
    }
  }
  if (check) {
    console.log(JSON.stringify({
      product: 'mutsumi', mode, port: Number(port),
      gemini_key_configured: mode === 'live' && Boolean(settings.GEMINI_API_KEY),
      free_tier_confirmed: confirmed,
      analysis_enabled: confirmed && Boolean(settings.GEMINI_API_KEY),
      live_verified: false, cloud_requests: 0, local_proxy_configured: Boolean(proxy),
    }));
    return;
  }
  const entry = path.join(root, 'dist', 'server', 'main.js');
  try { if (!(await stat(entry)).isFile()) throw new Error(); }
  catch { throw new Error('Build the server first with npm run build.'); }
  const childEnv = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'HOMEDRIVE', 'HOMEPATH']) {
    if (typeof process.env[name] === 'string') childEnv[name] = process.env[name];
  }
  Object.assign(childEnv, {
    MUTSUMI_PROJECT_ROOT: root, MUTSUMI_MODE: mode, MUTSUMI_PORT: port,
    MUTSUMI_DATA_DIR: settings.MUTSUMI_DATA_DIR || '',
    MUTSUMI_FFMPEG_BIN: settings.MUTSUMI_FFMPEG_BIN || 'ffmpeg',
    MUTSUMI_FFPROBE_BIN: settings.MUTSUMI_FFPROBE_BIN || 'ffprobe',
    GEMINI_FREE_TIER_CONFIRMED: confirmed ? 'true' : 'false',
  });
  if (confirmed && settings.GEMINI_API_KEY) childEnv.GEMINI_API_KEY = settings.GEMINI_API_KEY;
  const nodeArgs = [];
  if (proxy) {
    childEnv.HTTP_PROXY = proxy.href;
    childEnv.HTTPS_PROXY = proxy.href;
    childEnv.NO_PROXY = 'localhost,127.0.0.1,::1';
    nodeArgs.push('--use-env-proxy');
  }
  nodeArgs.push(entry);
  const child = spawn(process.execPath, nodeArgs, {
    cwd: root, env: childEnv, shell: false, windowsHide: true, stdio: 'inherit',
  });
  const stop = () => child.kill();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Cannot launch the local server.')));
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      process.exitCode = code ?? (signal ? 1 : 0); resolve();
    });
  });
}
launch().catch(error => {
  const messages = new Set(['Cannot read local configuration.', 'Duplicate runtime setting.',
    'Invalid runtime setting.', 'Invalid local port.', 'Invalid free-tier confirmation.',
    'Only the selected official Gemini service is configured.',
    'Proxy must be an explicit local HTTP address.', 'Build the server first with npm run build.',
    'Cannot launch the local server.']);
  console.error(messages.has(error?.message) ? error.message : 'Local server configuration failed.');
  process.exitCode = 1;
});

