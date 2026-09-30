# H00 — DeepSeek Codex CLI smoke task

Status: released on 2026-10-01. Owner supplied official DeepSeek credentials and selected deepseek-flash in .env. Supervisor runs this task only; application providers remain pending discussion.

## Purpose

Confirm that the selected DeepSeek endpoint supports an actual Codex CLI tool loop, including a scoped file edit. A plain text API response is insufficient evidence.

## Prompt to implementer

You are the DeepSeek implementation agent for the voicebot project. Follow the workspace AGENTS.md. This task only verifies the coding harness.

1. Read `docs/tasks/H00-harness-smoke.md` and `voice-system-flow.md`.
2. Create only `.runtime/harness-smoke/result.json` with a task ID, a short summary of the manual recording flow, and `automatic_turn_detection: false`. Do not fabricate model identity; the supervisor records it from invocation settings.
3. Read that file back to verify it is valid JSON.
4. Return the created path and verification result. Do not implement any application code.

Do not read `.env`, list environment variables, modify global settings or perform network calls through shell tools. The harness itself handles the model connection.

## Supervisor acceptance

- Invocation selected the agreed DeepSeek model/provider.
- Tool calls executed; expected file exists and has correct JSON fields.
- No out-of-scope edits or credential exposure.
- Exit status and limitations are captured.
- This confirms coding connectivity only, not voice application functionality.
