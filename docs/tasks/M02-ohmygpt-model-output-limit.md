# Use the selected model's full output ceiling

Preferred implementer Qwen3.8-Flash via restricted Codex CLI. The owner explicitly chose Gemini 3.8 Flash's model output limit instead of the supervisor's 4096 cost ceiling. Decision D24 records this approval. Primary model specification: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/ lists 65536 output tokens and low/medium/high thinking; minimal is unsupported.

Modify ONLY apps/server/src/providers/ohmygpt/ohmygpt-audio-analysis.ts with ONE physical write, then stop for supervisor commit. Locate and change ONLY the request member max_tokens: 4096 to max_tokens: 65536. Preserve reasoning_effort:'low', endpoint/model, schema, prompt, timeout, byte bounds, mapper, no-retry behavior and all other code. Do not change unrelated 4096 key-length limits. Do not edit tests yet; their old request-cap assertion is expected to need a separate subsequent single-file task.

No Git mutations, dotenv, secret variables, recordings, raw responses, network calls or other files. Flow/architecture are preloaded. One targeted read, an asserted unique string replacement built in memory and one write, then ONLY npm run typecheck. Report actual result and implementer; stop before further edits. Official DeepSeek coding fallback remains approved only if Qwen fails; do not launch it yourself.
