# M02d — Preserve trusted failures by identity

Authorized official DeepSeek fallback. Read AGENTS.md, flow/architecture, M02-filetrans-analysis.md and tests/acceptance/filetrans-analysis.test.mjs. Modify ONLY apps/server/src/providers/aliyun/filetrans-analysis.ts, ONE successful write, no re-edit. No test/contract/package/Git/credential/private data changes. Saved-file read-back only; supervisor checks.

Supervisor ran node --test tests/acceptance/filetrans-analysis.test.mjs: 53 cases, 50 passed, 3 failed. Source asFailure/isAnalysisFailure incorrectly trusts arbitrary external plain objects matching a public error shape, preserving foreign message/cause and spoofed cancelled code. Failing groups are foreign submission, polling and download failures. All other behavior currently passes.

Repair with module-private identity provenance, e.g. WeakSet<object>: failure() registers newly constructed safe internal failures; isAnalysisFailure recognizes only registered object identity, without reading any foreign fields/prototype/getters. Remove unused FAILURE_CODES and shape recognition. A mapper's returned safe error must be explicitly registered immediately at the internal mapFiletransResult call before throwing it, so timing_unavailable and other mapper codes remain unchanged. Never register exceptions caught from external fetch/sleep/body, and do not weaken tests or broadly register arbitrary thrown objects. Keep thrown failures plain with exactly code/stage/message/retryable; no enumerable marker/cause. Preserve genuine internal cancelled/timed_out, static messages, reference validation, limits, header isolation, single submission and cleanup. No unrelated refactor.

Report exact file and reviewed changes; no claim of supervisor acceptance or unrun tests.
