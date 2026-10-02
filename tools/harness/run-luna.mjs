import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Supervisor orchestration; application code is delegated to GPT-6-Luna.
const root = fileURLToPath(new URL('../../', import.meta.url));
const model = 'gpt-6-luna';
const effortOverride = process.argv.slice(3).find(arg => arg.startsWith('--effort='))?.slice('--effort='.length);
const effort = effortOverride || 'medium';
if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Invalid Luna reasoning effort');
const timeoutOverride = process.argv.slice(3).find(arg => arg.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length);
const timeoutMs = timeoutOverride ? Number(timeoutOverride) : 300000;
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1200000) throw new Error('Timeout must be 1000..1200000 milliseconds');
const executable = process.env.VOICEBOT_CODEX_BIN || 'codex';
const cli = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false });
if (cli.status !== 0) throw new Error('Codex CLI unavailable');
if (process.argv[2] === '--check') {
  const login = spawnSync(executable, ['login', 'status'], { encoding: 'utf8', shell: false });
  const signedIn = login.status === 0 && /Logged in using ChatGPT/.test(login.stdout + login.stderr);
  console.log(JSON.stringify({ cli: cli.stdout.trim(), model, effort, chatgpt_authenticated: signedIn, live_verified: false }));
  process.exit(signedIn ? 0 : 1);
}
const taskArg = process.argv[2];
if (!taskArg) throw new Error('Usage: node tools/harness/run-luna.mjs docs/tasks/TASK.md');
const taskPath = await realpath(path.resolve(root, taskArg));
const taskRoot = await realpath(path.join(root, 'docs/tasks'));
const task = path.relative(taskRoot, taskPath);
if (task.startsWith('..') || path.isAbsolute(task) || !task.endsWith('.md')) throw new Error('Task must be inside docs/tasks');
const contextNames = ['AGENTS.md', 'voice-system-flow.md', 'docs/architecture.md', 'docs/sleep-work-plan.md'];
const context = await Promise.all(contextNames.map(async name => `## Preloaded context: ${name}\n${await readFile(path.join(root, name), 'utf8')}`));
const prompt = 'The supervisor, not the implementing agent, performs the immediate per-file Git commit required by AGENTS.md. Any physical change of the target counts as the one allowed write, including a truncated or incomplete file and a command with diagnostics. Once the target changes, never repair, append, overwrite or revert it in this invocation; perform only the read-only check, report failure if needed and stop so the supervisor can commit before the next repair. Keep shell write commands below 30000 characters; build and verify all content in memory before writing. Do not run git add/commit/reset/checkout or any other Git mutation. Do not invoke tools/harness, harness:check, launchers, .env loaders or any other credential-reading script, even for verification. The four required context documents are supplied completely below; read them here before editing and do not reopen or search these same documents through tools. Read only the assigned source dependencies next. Never embed a literal NUL in tool JSON or shell commands; write code checks with String.fromCharCode(0) or numeric charCodeAt comparisons instead of null-character escapes. After your single file write and the exact read-only checks in the brief, report and stop.\n\n' + context.join('\n\n') + '\n\n## Assigned task\n' + await readFile(taskPath, 'utf8');
const redact = text => text.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
const configs = {
  model_provider: 'openai',
  model_reasoning_effort: effort,
  web_search: 'disabled',
  show_raw_agent_reasoning: false,
  approval_policy: 'never',
  'windows.sandbox': 'unelevated',
  'features.apps': false,
  'features.plugins': false,
  'shell_environment_policy.exclude': ['DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'OHMYGPT_API_KEY', 'TYPESAFE_API_KEY', 'TYPESAFE_API_KEY_2'],
};
const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--color', 'never', '-C', root, '-s', 'workspace-write', '-m', model];
for (const [name, value] of Object.entries(configs)) args.push('-c', `${name}=${JSON.stringify(value)}`);
args.push('-');
const env = { ...process.env };
for (const name of ['DASHSCOPE_API_KEY','DEEPSEEK_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OPENROUTER_API_KEY','OHMYGPT_API_KEY', 'TYPESAFE_API_KEY', 'TYPESAFE_API_KEY_2']) delete env[name];
const outputDir = path.join(root, '.runtime/harness-runs', new Date().toISOString().replaceAll(':', '-'));
await mkdir(outputDir, { recursive: true });
const child = spawn(executable, args, { cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '', progressBuffer = '', timedOut = false, overflow = false, cancelled = false, connectionFailed = false;
const limit = 4 * 1024 * 1024;
child.stdout.on('data', chunk => {
  stdout += chunk;
  if (stdout.length > limit) { overflow = true; child.kill(); return; }
  progressBuffer += chunk;
  const lines = progressBuffer.split('\n');
  progressBuffer = lines.pop() || '';
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.item?.type === 'command_execution' && event.type === 'item.started') {
        console.log(JSON.stringify({ progress: 'tool_started', command_preview: redact(String(event.item.command ?? '')).slice(0, 180) }));
      }
      if (event.item?.type === 'command_execution' && event.type === 'item.completed') {
        console.log(JSON.stringify({ progress: 'tool_completed', exit_code: event.item.exit_code }));
      }
    } catch { /* Full redacted output is captured after completion. */ }
  }
});
child.stderr.on('data', chunk => {
  stderr += chunk;
  if (stderr.length > limit) { overflow = true; child.kill(); return; }
  if (!connectionFailed && (stderr.match(/stream connection failed/g) || []).length >= 2) {
    connectionFailed = true;
    console.log(JSON.stringify({ progress: 'connection_failure_limit' }));
    child.kill();
  }
});
child.stdin.on('error', () => {});
const cancel = () => { cancelled = true; child.kill(); };
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
const completion = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
child.stdin.end(`Execute only this brief. Read AGENTS.md first and the required flow/architecture. Never read .env or enumerate environment variables. Do not inspect data/ or .runtime artifacts outside the brief's explicit target path. Read only required context and assigned source/test files; no speculative workspace discovery. Never recursively enumerate the workspace (including Get-ChildItem -Recurse or workspace-wide rg --files); inspect only the exact files named in the brief. Known setup: Node 25, root package.json, TypeScript at node_modules/typescript/bin/tsc. For erasable files use --noEmit --strict --allowImportingTsExtensions --target ES2022 --module NodeNext --moduleResolution NodeNext; value imports use explicit .ts, type imports may use .ts/.js. Do not search for a tsconfig unless the brief explicitly assigns one. Read required documents together in one command and do not repeatedly reread the domain validator for type-only work. The shell is PowerShell 7: use native Get-Content/Select-Object and rg; do not nest powershell/pwsh/bash or use Unix grep, wc, cat -n, or Bash heredocs. For multiline inline Node/Python, use a PowerShell single-quoted here-string piped directly to the interpreter. Do not delegate, discover connectors, edit unassigned files or call providers through shell. Stop after two identical infrastructure errors. Windows shell commands have an approximately 32 KiB hard limit: keep command strings below 20 KiB and avoid large whole-file shell payloads. Before a replacement write, build proposed content in memory and assert every required anchor matches exactly once and every requested change is present; never silently write a partial patch. Make exactly ONE successful write total, to the assigned target only; never re-edit, compact, format or fix the written file in this invocation. Never create temporary test scripts or any other file for verification, even if you would delete it later. Use inline/in-memory verification or run existing tests directly with Node (node --test workers may be EPERM-blocked). Supervisor commits before any next edit.\n\n${prompt}`);
console.log(JSON.stringify({ status: 'started', model, effort, timeout_ms: timeoutMs, provider: 'openai-chatgpt', task }));
let result;
try { result = await completion; } finally { clearTimeout(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
const events = stdout.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(redact(line)); } catch { return { type: 'unparsed', text: redact(line) }; } });
const report = { ...result, model, effort, timeout_ms: timeoutMs, provider: 'openai-chatgpt', cli: cli.stdout.trim(), task, chatgpt_authenticated: true, timedOut, overflow, cancelled, connectionFailed, events, stderr: redact(stderr) };
const reportPath = path.join(outputDir, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...result, model, timedOut, overflow, cancelled, connectionFailed, report_path: reportPath, final_messages: events.filter(e => e.item?.type === 'agent_message').map(e => e.item.text), stderr: redact(stderr).slice(-3000) }));
process.exitCode = result.code === 0 && !timedOut && !overflow && !cancelled && !connectionFailed ? 0 : 1;
