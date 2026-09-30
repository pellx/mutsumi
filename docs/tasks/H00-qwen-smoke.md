# H00-Qwen — authenticated Codex CLI file-tool verification

Status: released; waiting for DASHSCOPE_API_KEY to be filled locally. Project: mutsumi. Model: Alibaba Model Studio qwen3.8-flash. This supersedes further DeepSeek harness runs.

Read AGENTS.md and voice-system-flow.md. Create ONLY .runtime/qwen-smoke/result.json in one patch, with task_id H00-Qwen, a brief summary of manual recording/full-turn processing, and automatic_turn_detection:false. Read it back and validate JSON with Node or PowerShell. Return the created path, actual commands/results and limitations. Do not fabricate your model identity; supervisor records invocation metadata.

No application code, tracked-file edits, Git writes, .env reads, environment enumeration, connector discovery, delegation, network shell calls or global settings changes. Stop after two identical infrastructure failures; do not try unassigned probe paths. This ignored artifact does not need a Git commit.

Supervisor accepts only when the expected file independently parses, matches manual interaction, tool execution really occurred, worktree remains unchanged and logs have no credential exposure. An API text reply or zero CLI exit is insufficient. This proves coding connectivity, not the voice app.
