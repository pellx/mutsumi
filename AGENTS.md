# Voicebot development agreement

## Roles

- The human owner chooses product scope and, together with the supervising Codex agent, cloud providers/models and material tradeoffs.
- The supervising Codex agent owns architecture, interfaces, path organization, task briefs, review, and acceptance.
- DeepSeek, invoked through Codex CLI, implements application code inside the approved task's file scope. Do not silently replace this delegation with another model.
- Architecture and provider proposals are not approved merely because they appear in a document. Read `docs/decisions.md` for status before implementation.

## Scope and paths

- Workspace root: `D:\voicebot`. Resolve application paths from the project root/configuration; do not hard-code the developer's absolute paths in business code.
- Read `voice-system-flow.md`, `docs/architecture.md`, and the assigned task brief before editing.
- The initial product uses manual recording and complete-turn processing. No automatic turn detection, barge-in, WebSocket audio streaming, or interruption controller.
- Implement only the assigned module. If a required interface change exceeds scope, report it to the supervisor before changing it.
- Do not edit architecture documents, acceptance criteria, or this agreement to make implementation appear compliant.
- Do not overwrite unrelated work, publish, deploy, push, or modify global Codex configuration as part of a coding task.

## Secrets and data

- The supervising launcher may load specifically required credential variables from root `.env` into the process environment. Never evaluate dotenv content as executable code.
- Implementing agents must not open `.env`, enumerate secret environment variables, or include credentials in prompts, reports, commands, logs, frontend bundles, or fixtures.
- `.env.example` contains variable names and empty values only, except non-secret example service addresses.
- Real audio, conversations, database files, and raw provider responses belong in ignored `data/`; coding-run artifacts belong in ignored `.runtime/`.
- A model/provider may only receive the task context needed for its authorized role. Coding runs use synthetic fixtures, not private recorded conversations.

## Implementation and acceptance

- After each individual tracked-file creation or modification, immediately stage that exact file and create one Git commit before editing another file. Avoid batching several file edits into a single patch or commit. Generated/ignored secrets, recordings, logs, and build artifacts are excluded; never force-add them. If committing fails, resolve or report the failure before continuing edits.
- DeepSeek may draft commit messages; the supervisor verifies that each message matches the diff. Use explicit file paths when staging, preserve unrelated staged changes, and never amend/rewrite history without authorization. Small intermediate commits are expected; only independent acceptance establishes a module is complete.

- Keep provider-specific payloads inside adapters. Domain objects and orchestration must not depend on vendor SDK types.
- Missing emotion, timestamps, or sound-event capability is explicitly unavailable/unknown, not fabricated data.
- Planned speech timing differs from measured output timing. Never report a plan as a measured timestamp.
- Provider mocks are for development and must be visibly identified. A passing mock path does not prove a live integration works.
- Run the assigned module checks and report actual commands, outcomes, modified files, and remaining limitations. Do not claim unrun verification passed.
- The supervisor independently reviews the diff and validates acceptance criteria. Completion requires supervisor acceptance, not just the implementer's final message.
- Preserve sandbox and approval controls. If blocked, report the exact operation and reason rather than using unrestricted execution as a workaround.
