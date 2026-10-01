import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Supervisor tooling only: no application providers or business logic.
const root = fileURLToPath(new URL('../../', import.meta.url));
const taskArg = process.argv[2];
if (!taskArg) throw new Error('Usage: node tools/harness/run-deepseek.mjs docs/tasks/TASK.md');
const taskPath = await realpath(path.resolve(root, taskArg));
const taskRoot = await realpath(path.join(root, 'docs/tasks'));
const relative = path.relative(taskRoot, taskPath);
if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.md')) {
  throw new Error('Task must be a Markdown file inside docs/tasks');
}
const selected = {};
for (const line of (await readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*(DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL|DEEPSEEK_MODEL)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  selected[match[1]] = value;
}
const key = selected.DEEPSEEK_API_KEY;
if (!key || /[\r\n\0]/.test(key)) throw new Error('Missing or invalid DEEPSEEK_API_KEY');
const endpoint = new URL(selected.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
if (endpoint.href !== 'https://api.deepseek.com/') throw new Error('Only official DeepSeek root endpoint is approved');
const model = selected.DEEPSEEK_MODEL;
if (model !== 'deepseek-flash') throw new Error('This catalog currently approves deepseek-flash only');
const redact = text => text.split(key).join('[REDACTED]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
const executable = process.env.VOICEBOT_CODEX_BIN || 'codex';
const version = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false });
if (version.status !== 0) throw new Error('Codex executable unavailable');
const configs = {
  model_provider: 'deepseek',
  model_catalog_json: path.join(root, 'tools/harness/deepseek-models.json').replaceAll('\\', '/'),
  model_reasoning_effort: 'low',
  web_search: 'disabled',
  show_raw_agent_reasoning: false,
  approval_policy: 'never',
  // Official native fallback retains restricted-token workspace boundaries.
  'windows.sandbox': 'unelevated',
  'features.apps': false,
  'features.plugins': false,
  'model_providers.deepseek.name': 'DeepSeek official',
  'model_providers.deepseek.base_url': endpoint.href,
  'model_providers.deepseek.wire_api': 'responses',
  'model_providers.deepseek.env_key': 'DEEPSEEK_API_KEY',
  'model_providers.deepseek.requires_openai_auth': false,
  'model_providers.deepseek.supports_websockets': false,
  'model_providers.deepseek.request_max_retries': 1,
  'model_providers.deepseek.stream_max_retries': 1,
  'shell_environment_policy.exclude': ['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY'],
};
const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--color', 'never', '-C', root, '-s', 'workspace-write', '-m', model];
for (const [name, value] of Object.entries(configs)) args.push('-c', `${name}=${JSON.stringify(value)}`);
args.push('-');
const env = { ...process.env, DEEPSEEK_API_KEY: key };
delete env.OPENAI_API_KEY;
delete env.DASHSCOPE_API_KEY;
const outputDir = path.join(root, '.runtime/harness-runs', new Date().toISOString().replaceAll(':', '-'));
await mkdir(outputDir, { recursive: true });
const child = spawn(executable, args, { cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '', progressBuffer = '', timedOut = false, overflow = false, connectionFailures = 0, connectionFailed = false;
const limit = 4 * 1024 * 1024;
child.stdout.on('data', chunk => {
  stdout += chunk;
  if (stdout.length > limit) { overflow = true; child.kill(); return; }
  progressBuffer += chunk;
  const lines = progressBuffer.split('\n');
  progressBuffer = lines.pop() || '';
  for (const line of lines) {
    try { const e = JSON.parse(line); if (e.type === 'item.completed' && e.item?.type === 'command_execution') console.log(JSON.stringify({progress:'tool_completed',exit_code:e.item.exit_code})); } catch {}
  }
});
child.stderr.on('data', chunk => {
  stderr += chunk;
  if (stderr.length > limit) { overflow = true; child.kill(); return; }
  connectionFailures = (stderr.match(/stream connection failed/g) || []).length;
  if (connectionFailures >= 2 && !connectionFailed) {
    connectionFailed = true;
    console.log(JSON.stringify({status:'stopping',reason:'repeated_connection_failure'}));
    child.kill();
  }
});
child.stdin.on('error', () => {});
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
const completion = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
child.stdin.end(`Execute the assigned brief below. Read AGENTS.md first. Do not read .env or enumerate environment variables. Do not delegate to other agents or discover connectors. If a shell or patch fails twice with the same infrastructure error, stop and report; do not probe other file paths.\n\n${await readFile(taskPath, 'utf8')}`);
console.log(JSON.stringify({ status: 'started', model, provider: endpoint.hostname, cli: version.stdout.trim(), task: relative }));
let result;
try { result = await completion; } finally { clearTimeout(timer); }
const events = stdout.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(redact(line)); } catch { return { type: 'unparsed', text: redact(line) }; } });
const report = { ...result, model, provider: endpoint.hostname, cli: version.stdout.trim(), task: relative, timedOut, overflow, connectionFailed, events, stderr: redact(stderr) };
await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...result, model, timedOut, overflow, connectionFailed, report_path: path.join(outputDir, 'report.json'), event_types: events.map(e => e.type), final_messages: events.filter(e => e.item?.type === 'agent_message').map(e => e.item.text), stderr: redact(stderr).slice(-3000) }));
process.exitCode = result.code === 0 && !timedOut && !overflow && !connectionFailed ? 0 : 1;
