# Qwen connection diagnosis — 2026-10-01

Owner requested Qwen retry and asked whether balance was exhausted. Supervisor diagnosis used only the selected DASHSCOPE credential in memory; no other credential was sent to Alibaba. No private audio/conversation was included. Direct probes and coding artifacts are ignored under .runtime; no global Codex/proxy configuration changed.

## Evidence

1. Three tiny official qwen3.8-flash requests returned HTTP200: Chat Completions (669ms), Responses (1506ms), streaming Responses with medium effort (1003ms). Chat returned OK. Nonstream Responses reached its small output limit and was incomplete, so it establishes authentication/routing, not a completed answer. Streaming response emitted response.completed with status completed. None returned Arrearage, authentication or quota errors. These probes do not expose the account's remaining balance.
2. Original Codex CLI harness retry with unchanged routing reached its 90-second cap before model/tool output; repeated error: Connection failed: error sending request. Connection-only logs showed reqwest automatically discovering proxy http://127.0.0.1:7890 for DashScope.
3. Read-only Windows settings confirmed HKCU Internet Settings ProxyEnable=1, ProxyServer=127.0.0.1:7890. HTTP_PROXY/HTTPS_PROXY/ALL_PROXY were absent, explaining why previous environment-only checks missed it. The checked managed-network proxy settings were absent. DNS resolved both Alibaba and DeepSeek to IPv4, so no observed IPv6 issue. The exact failure inside the local proxy (rule, route or TLS) was not determined; no proxy settings were edited.
4. A per-process NO_PROXY exception for dashscope.aliyuncs.com restored Qwen replies and tool execution, with zero stream connection failures. Logs showed direct connections to Alibaba IPv4:443 while other hosts retained their proxy route. That smoke exceeded 90 seconds because the model performed unrelated discovery; it did not establish completed file-writing acceptance.
5. Launcher repair 2b19011 merges the selected Alibaba hostname into inherited NO_PROXY/no_proxy for its child only, preserving other routes and all sandbox/network-control settings. It also stops after two repeated connection failures and strengthens single-write/private-path restrictions. node --check and readiness check passed.
6. Narrowed task H00-qwen-recheck subsequently ran with the repaired launcher (no command-level proxy override), CLI 0.159.2, qwen3.8-flash, low effort, restricted workspace-write/unelevated sandbox, approval_policy never. CLI exit0; no timeout/overflow/cancellation/connection failure. Three successful commands read context, wrote one ignored artifact and parsed it. Supervisor independently parsed the new artifact with Node: task_id H00-qwen-recheck, automatic_turn_detection false, verification_nonce direct-route-20261001-v2, correct manual full-turn summary. Worktree had no implementer changes. Report: ignored .runtime/harness-runs/2026-10-01T03-52-49.529Z/report.json.

## Conclusion and limits

The reproduced connection failure was on the user's Windows proxy route. Direct routing of the selected Alibaba host restored the actual Codex CLI file-tool workflow. No observed billing error supports an insufficient-balance diagnosis; exact account balance remains unknown. Qwen is available as primary implementer again; previously authorized official DeepSeek fallback remains available if it fails. This establishes coding connectivity, not large-task performance or voice-provider quality. ASR zero-duration handling still awaits the separate D19 product choice.

Primary references checked:

- Alibaba billing failure is documented as 400-Arrearage: https://help.aliyun.com/zh/model-studio/error-code
- Alibaba Responses protocol and reasoning levels: https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses
- Codex Responses streaming/tool verification: https://learn.chatgpt.com/docs/enterprise/gateway-compatibility
