# DeepSeek implementation and Codex acceptance

## Per-module workflow

1. Discuss the module's purpose, chosen provider/model, input/output, unsupported capabilities, and cost-relevant behavior with the owner.
2. Supervisor records confirmed decisions and releases a task brief with exact allowed paths and acceptance criteria.
3. Launcher reads only required coding-provider settings from `.env` in memory and invokes DeepSeek through `codex exec`. Never put keys in the prompt, command arguments or model catalog.
4. Release exactly one tracked-file edit per coding invocation. DeepSeek makes one creation/modification patch and stops editing, runs read-only checks, and proposes a commit message. Supervisor immediately commits that exact file before releasing another edit. If more edits are required, use separate invocations.
5. Supervisor inspects the changes and independently verifies contract behavior, errors, secret handling and actual integration where credentials/provider decisions permit.
6. Supervisor sends concrete failure cases and expected behavior back through the same harness. Repeat within the released task, with finite run/time limits.
7. Record acceptance or precise outstanding issues before releasing the next module.

## Harness design

- Use the installed Codex CLI as the file/tool execution harness, with the selected DeepSeek provider as the inference model.
- Current official DeepSeek documentation supports Responses API. Third-party provider compatibility must be checked independently.
- Use invocation-local provider overrides and project-owned model metadata; do not run setup scripts that rewrite the user's global Codex configuration.
- Use project-root working directory and workspace-write sandbox for implementation. The installed Windows elevated sandbox fails with setup-refresh errors locally; the official unelevated restricted-token sandbox passed H00. Child coding runs use approval_policy=never and cannot escalate. Never select `danger-full-access` or bypass approval controls.
- Pass the task prompt via stdin. Do not include `.env`, real conversation recordings or unrelated personal files in context.
- Keep the coding credential available to the API client while excluding it from generated shell-command environments where supported. This exclusion is not a filesystem security boundary; task instructions also prohibit reading `.env`.
- Preserve inherited permission and exec-policy restrictions; do not disable policy rules to make the run succeed.
- Use bounded process time and request retries. Do not retry an entire writing task blindly after a timeout; inspect partial changes first.
- Keep redacted run summaries in `.runtime/`; reusable prompts and review decisions go in `docs/`. Do not collect raw provider traffic by default.
- Record CLI version, provider hostname, model ID, task ID, exit status and reviewed file list. No claim of a live successful run until an authenticated smoke task passes.

## Acceptance evidence

- Diff stays within the task's allowed paths.
- Normal case and meaningful failure cases satisfy the declared contract.
- Type/build checks and relevant tests actually run; report commands and results.
- Synthetic-provider success and real-provider success are reported separately.
- For speech adapters: listen to representative generated clips and inspect actual timing/control support. Programmatic correctness alone is not acceptance of natural emotion.
- User makes the final subjective voice/personality preference decisions from playable samples.

## Current prerequisite

H00 accepted on 2026-10-01 with Codex CLI 0.159.2, official api.deepseek.com and deepseek-flash. The supervisor independently checked the JSON deliverable and clean tracked worktree. Run `node tools/harness/run-deepseek.mjs docs/tasks/TASK.md`; credentials are loaded from .env without appearing in command arguments. The launcher uses local model metadata, disables apps/plugins/web search for task focus, excludes the coding key from tool shell environments and records redacted reports in ignored .runtime. CLI zero exit alone does not establish task acceptance.

After a substantial module passes independent acceptance, push committed public project files to origin (https://github.com/pellx/mutsumi), as authorized by the owner. Check ignore rules and tracked content first; do not upload .env, runtime logs or private recordings. Do not push unsuccessful drafts merely to mark progress.
