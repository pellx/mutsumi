# Explicit primitive types in the relay response schema

Preferred implementer Qwen3.8-Flash via Codex CLI. Modify ONLY apps/server/src/providers/ohmygpt/ohmygpt-audio-analysis.ts with one physical write, then stop for supervisor commit. No Git mutations, secrets, dotenv, data, live calls, launchers or other files. Flow/architecture are preloaded. Read ONLY the ~25-line toOpenApiSchemaSubset function and, if needed, the schema declaration near granularity in apps/server/src/providers/google/gemini-audio-result.ts. Do not reread the full adapter or discover files.

The shared schema represents granularity as an enum of two strings without explicit type. This is legal JSON Schema but the relay's Gemini schema conversion requires a concrete type on this leaf. Fix ONLY the local wire-schema conversion. After copying a record, when it has no type and has a nonempty enum array whose members are all strings, set the fresh copy's type to 'string'. Preserve every enum value and all existing types. Do not guess mixed/empty enum types. Keep nullable handling, recursive copying, $schema removal and shared schema immutability intact. No relaxation of the mapper, timing requirements or output validation; no endpoint/model change.

Primary reference: https://ai.google.dev/gemini-api/docs/structured-output . Keep strict:true and the chosen ordinary relay route.

Build in memory with an asserted unique function anchor, write once. Then run ONLY npm run typecheck and report actual outcome; stop before further edits. Three shell calls suffice: targeted read, asserted edit/write, typecheck. Official DeepSeek fallback is permitted by the latest owner agreement if Qwen cannot finish; this invocation must identify the actual model and cannot launch another harness.
