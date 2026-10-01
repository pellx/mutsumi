# M02 process-runner TypeScript repair

Qwen3.8-Flash; DeepSeek fallback D22. Required AGENTS/flow/architecture/sleep-plan are supplied in the harness prompt; read them there, do not reopen. Read ONLY apps/server/src/application/audio-tool-process.ts next. Modify that file in ONE write, no Git/harness/launchers/secrets/cloud/discovery/other files.

Independent runtime checks passed14 cases, but strict tsc reports TS2345: mutable killReason loses narrowing inside the close-event nested callback. In the existing if(killReason) block, capture const reason=killReason before the nested finish callback and pass reason to makeRoundError. This is the only requested change. Do not alter error codes, timers, IO, environment or formatting. Exact-once anchor before one write; run node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json (actual exit propagation), report and stop. Supervisor immediately commits and retests.
