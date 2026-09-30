import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Supervisor orchestration; application code is delegated to Qwen.
const root = fileURLToPath(new URL('../../', import.meta.url));
const settings = {};
for (const line of (await readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*(DASHSCOPE_API_KEY|QWEN_BASE_URL|QWEN_MODEL|QWEN_REASONING_EFFORT)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  if (Object.hasOwn(settings, match[1])) throw new Error(`Duplicate setting: ${match[1]}`);
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  settings[match[1]] = value;
}
const endpoint = new URL(settings.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
const approvedHost = endpoint.hostname === 'dashscope.aliyuncs.com' || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(endpoint.hostname);
if (!approvedHost || endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/compatible-mode\/v1\/?$/.test(endpoint.pathname)) {
  throw new Error('Only Alibaba Beijing HTTPS compatible-mode/v1 endpoints are approved');
}
const model = settings.QWEN_MODEL || 'qwen3.8-flash';
if (model !== 'qwen3.8-flash') throw new Error('Only qwen3.8-flash is selected');
const effort = settings.QWEN_REASONING_EFFORT || 'xhigh';
if (!['low', 'medium', 'xhigh'].includes(effort)) throw new Error('Invalid Qwen reasoning effort');
const executable = process.env.VOICEBOT_CODEX_BIN || 'codex';
const cli = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false });
if (cli.status !== 0) throw new Error('Codex CLI unavailable');
const key = settings.DASHSCOPE_API_KEY;
const metadataPath = path.join(root, 'tools/harness/qwen-models.json');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (!metadata.models?.some(entry => entry.slug === model)) throw new Error('Model catalog mismatch');
if (process.argv[2] === '--check') {
  console.log(JSON.stringify({ cli: cli.stdout.trim(), model, effort, provider: endpoint.hostname, key_configured: Boolean(key), live_verified: false }));
  process.exit(0);
}
if (!key || /[\r\n\0]/.test(key)) throw new Error('Fill DASHSCOPE_API_KEY locally in .env');
const taskArg = process.argv[2];
if (!taskArg) throw new Error('Usage: node tools/harness/run-qwen.mjs docs/tasks/TASK.md');
const taskPath = await realpath(path.resolve(root, taskArg));
const taskRoot = await realpath(path.join(root, 'docs/tasks'));
const task = path.relative(taskRoot, taskPath);
if (task.startsWith('..') || path.isAbsolute(task) || !task.endsWith('.md')) throw new Error('Task must be inside docs/tasks');
const prompt = await readFile(taskPath, 'utf8');
const redact = text => text.split(key).join('[REDACTED]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
const configs = {
  model_provider: 'qwen',
  model_catalog_json: metadataPath.replaceAll('\\', '/'),
  model_reasoning_effort: effort,
  web_search: 'disabled',
  show_raw_agent_reasoning: false,
  approval_policy: 'never',
  'windows.sandbox': 'unelevated',
  'features.apps': false,
  'features.plugins': false,
  'model_providers.qwen.name': 'Alibaba Model Studio',
  'model_providers.qwen.base_url': endpoint.href,
  'model_providers.qwen.wire_api': 'responses',
  'model_providers.qwen.env_key': 'DASHSCOPE_API_KEY',
  'model_providers.qwen.requires_openai_auth': false,
  'model_providers.qwen.supports_websockets': false,
  'model_providers.qwen.request_max_retries': 1,
  'model_providers.qwen.stream_max_retries': 1,
  'shell_environment_policy.exclude': ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
};
const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--color', 'never', '-C', root, '-s', 'workspace-write', '-m', model];
for (const [name, value] of Object.entries(configs)) args.push('-c', `${name}=${JSON.stringify(value)}`);
args.push('-');
const env = { ...process.env, DASHSCOPE_API_KEY: key };
delete env.DEEPSEEK_API_KEY;
delete env.OPENAI_API_KEY;
const outputDir = path.join(root, '.runtime/harness-runs', new Date().toISOString().replaceAll(':', '-'));
await mkdir(outputDir, { recursive: true });
const child = spawn(executable, args, { cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '', timedOut = false, overflow = false, cancelled = false;
const limit = 4 * 1024 * 1024;
child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > limit) { overflow = true; child.kill(); } });
child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > limit) { overflow = true; child.kill(); } });
child.stdin.on('error', () => {});
const cancel = () => { cancelled = true; child.kill(); };
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
const completion = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
child.stdin.end(`Execute this brief. Read AGENTS.md first. Never read .env or enumerate environment variables. Do not delegate, discover connectors, edit unassigned files or call providers through shell. Stop after two identical infrastructure errors. For tracked files make exactly one edit patch; supervisor commits before the next edit.\n\n${prompt}`);
console.log(JSON.stringify({ status: 'started', model, effort, provider: endpoint.hostname, task }));
let result;
try { result = await completion; } finally { clearTimeout(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
const events = stdout.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(redact(line)); } catch { return { type: 'unparsed', text: redact(line) }; } });
const report = { ...result, model, effort, provider: endpoint.hostname, cli: cli.stdout.trim(), task, timedOut, overflow, cancelled, events, stderr: redact(stderr) };
const reportPath = path.join(outputDir, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...result, model, timedOut, overflow, cancelled, report_path: reportPath, final_messages: events.filter(e => e.item?.type === 'agent_message').map(e => e.item.text), stderr: redact(stderr).slice(-3000) }));
process.exitCode = result.code === 0 && !timedOut && !overflow && !cancelled ? 0 : 1;
