# M03 runtime canonical path repair

Edit ONLY apps/server/src/application/runtime.ts once. Read ONLY that file. No other edits, Git, secrets, data, harness or cloud calls. Qwen primary.

Supervisor found an absolute path such as projectRoot/data/../docs passes the textual prefix check before storage later normalizes it. Validate projectRoot is absolute at createRuntime entry (static safe error); resolve base with resolve(projectRoot,'data') and ALWAYS canonicalize custom absolute and relative paths with resolve(projectRoot,dataDirectory) before checking equality/base+separator. Keep constructor contract, health, ports and all other behavior. Do not change tests/architecture. One successful target write then npm run typecheck and stop.
