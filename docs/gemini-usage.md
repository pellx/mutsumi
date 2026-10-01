# Gemini usage for this prototype

Checked 2026-10-01. Start with a **Free Tier Gemini API project**, not a purchase. Gemini 3.8 Flash Standard lists free input/output under its free tier; access and limits still depend on the project. Confirm the actual tier in [AI Studio](https://aistudio.google.com/). A paid project's zero prepaid balance does not automatically return it to Free Tier; a separate free project/key may be appropriate. [Official billing guide](https://ai.google.dev/gemini-api/docs/billing)

The current saved preflight returned403 API_KEY_SERVICE_BLOCKED on the official service's GetModel method. This is not evidence of an empty balance, and no audio/generation POST has run. Check the API key's allowed APIs and that the Generative Language API is enabled/allowed. Metadata failure alone does not prove a generation request failed. Do not publish keys in screenshots, chat or Git.

Only after the owner confirms the selected project permits free-tier API use, set GEMINI_FREE_TIER_CONFIRMED=true in ignored root .env. This project flag is an owner attestation, **not a Google API switch that prevents billing**. Standard service_tier also does not force free use on a paid project. The default empty flag disables runtime Gemini before reading audio or making a request. No launcher should infer the tier from a key, turn on billing, top up, enable automatic reload or retry a failed generation.

If paid testing is explicitly chosen later, the documented minimum prepaid purchase is **$5**; there is no need to fund a large balance for a small ASR pilot. This is a later option, not authorized by D22's free-only instruction. [Billing options](https://ai.google.dev/gemini-api/docs/billing)

Gemini 3.8 Flash Standard's listed paid prices through2026-12-31 are **$0.75 per million input tokens** and **$3.75 per million output tokens including thinking**; listed2027 prices double. [Model pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash) Audio contributes32tokens/second: this owner's approximately5.2s clip is about167 audio tokens and the prototype30s maximum about960, before the text prompt/schema. Structured word timestamps and thinking also consume output tokens. [Audio token details](https://ai.google.dev/gemini-api/docs/audio#technical-details-about-audio)

Illustrative arithmetic only: 1000input tokens and2000combined output/thought tokens would cost about$0.00825 at those paid prices. $5 would cover roughly606such analysis calls. This is not measured usage or a guarantee; actual word counts, thought tokens, rate limits and later pricing matter. Dialogue/TTS and Qwen/DeepSeek coding calls are separate costs. No genuine Gemini usage has yet been measured here.

For this pilot use one short stateless analysis call with low thinking, no search grounding, no history, no background agent and no automatic retries. Standard suits the owner's free-tier-first request. A monthly consumer AI subscription is not needed just to run this API pilot; investigate any already-owned developer credits only if later changing to paid use. Free/paid data-use policies differ; review the project's actual terms alongside its tier. [Pricing and data policy](https://ai.google.dev/gemini-api/docs/pricing)

Live recognition acceptance remains pending. Offline fake-transport checks establish protocol boundaries only, while Google-generated word times are explicitly model estimates and candidate emotions remain segment-level.

