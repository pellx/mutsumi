# Gemini access diagnosis (2026-10-02)

The owner stopped unrelated module work and prioritized connecting official gemini-3.8-flash for real speech unit/slice inspection. The unrelated Qwen HTTP-test run was interrupted before any file write; Git status was clean. The local development preview remains visibly mocked and is not real recognition acceptance.

## Actual checks

- Supervisor independently ran node --test tests/acceptance/gemini-audio-analysis.test.mjs:18 passed,0 failed. These use injected fake transports and synthetic structural bytes only. Official DeepSeek fallback authored the file after a bounded Qwen timeout with no edits. This is offline protocol coverage, not recognition quality.
- Named runtime configuration check initially showed Gemini key configured,free_tier_confirmed:false,analysis_enabled:false,local_proxy_configured:false.
- Existing Windows proxy was enabled at127.0.0.1:7890. Supervisor metadata GETs to the fixed official models/gemini-3.8-flash endpoint used that local proxy with TLS verification and redirect:error. Both reached Google and returned403; one reported SERVICE_DISABLED and the subsequent one API_KEY_SERVICE_BLOCKED, each naming generativelanguage.googleapis.com. Neither request contained audio, prompts or generation parameters. No audio/generation POST has run.
- Current evidence requires checking both the matching project's API enablement and the key's API restrictions. It does not prove empty balance, quota exhaustion, a missing model, or a generation request failure. Metadata-method permission failure alone does not establish generation behavior.
- Supervisor filled only the previously empty non-secret GEMINI_PROXY_URL in ignored root .env with the owner's existing local HTTP proxy. Keys and free-tier confirmation were preserved. The current redacted check shows local_proxy_configured:true and free_tier_confirmed:false,so runtime audio calls remain disabled.
- Browser control initialization failed (Windows sandbox helper setup error); reset/retry also exited. No sandbox bypass was attempted. The matching project's official API-library page was queued in the Codex browser for owner action. No Google login,key creation,billing change or API enablement was claimed.

## Concrete next steps

1. In the Cloud project linked to the selected key,open API Library and enable Generative Language API. The private diagnostic under .runtime/qa/ contains a project-specific link; account identifiers and raw responses are not tracked here.
2. Check AI Studio's actual Billing Tier is Free Tier. A zero balance/key alone does not prove this. Keep billing/top-up disabled under the owner's free-only instruction.
3. Check the key permits generativelanguage.googleapis.com. The current official key guide says new AI Studio keys default to authorization keys and unrestricted standard keys are rejected; explicitly restricted standard keys still work. Do not send a Gemini key to another service or paste its value into chat.
4. After the owner confirms usable free-tier access,enable the local attestation and run the existing NestJS intake -> Gemini adapter -> validated annotation path on the owner-authorized human MP3,once with no transcript hint or automatic retry. Display every returned readable word/subword and its positive bounds,provenance and segment candidate emotion; timing remains a model estimate.

Owner/admin console action is still needed; hand-held API credentials are not an authenticated service-administration session. Real Gemini unit splitting/slicing is pending this prerequisite. Unrelated coding tasks stay deferred until requested again.

Official references checked2026-10-02: [enable a service](https://docs.cloud.google.com/service-usage/docs/enable-disable),[Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key),[AI Studio permissions](https://ai.google.dev/gemini-api/docs/troubleshoot-ai-studio),[billing tiers](https://ai.google.dev/gemini-api/docs/billing).
