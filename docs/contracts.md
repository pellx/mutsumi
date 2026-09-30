# Provider-independent contracts — v0.1 draft

## Shared conventions

- JSON field names use `snake_case`; persisted documents carry `schema_version: "0.1"`.
- Times are integer milliseconds relative to the associated audio asset's start. Never mix input and output clocks. Require `0 <= start_ms < end_ms <= duration_ms` when times are present.
- Missing timing is `null` with an unavailable reason. Do not assign zero or evenly divide a sentence to fabricate character timing.
- Identify assets by server-generated IDs; browser/API clients do not submit filesystem paths.
- Provider status distinguishes `ok`, `unavailable`, and `failed`; empty detected-events plus `ok` differs from an unsupported detector.
- Numeric scores retain their source and semantics (`probability`, `confidence`, `ordinal`, or `uncalibrated_score`). Only a distribution expressly defined as exclusive should be required to sum to one.
- Domain schema validation applies to model outputs before they reach TTS or storage.

## Main documents

### AudioAsset

`asset_id`, actual `media_type`, `duration_ms`, `sample_rate_hz`, `channels`; normalized assets additionally reference `original_asset_id` and any time mapping. Internal storage paths stay server-side. Report the actual detected audio format, not only a browser-supplied MIME type.

### AnnotatedAudio

`schema_version`, `asset_id`, `transcript`, `segments`, `observations`, `capabilities`.

- Transcript segment: `segment_id`, `text`, optional `speaker_id`, `start_ms`, `end_ms`, `timing_source`, `granularity` (`segment`, `word`, `character`), optional nested word/character units.
- Observation: `observation_id`, `kind` (`emotion`, `prosody`, `sound_event`), `label`, time interval if available, `source_provider`, `source_model`, optional score and score semantics, optional referenced segment IDs.
- Observations may overlap. Emotions are candidate interpretations, not asserted internal states of the speaker.
- Large audio/feature tensors are stored as assets, not embedded into text prompts. Context builder selects the relevant textual summary and references.

### DialogueContext and ReplyDraft

- DialogueContext: persona, current user's text and relevant observations, bounded recent history, selected explicit memories, capability gaps.
- ReplyDraft: `reply_text` and optional proposed phrase-level expression cues. This document does not contain measured speech timestamps.

### ReplyPlan

`reply_id`, ordered `segments` containing `text`, `tone`, `emotion_intensity`, optional `pace`, `pause_after_ms`, and text spans for emphasis. Emotion/intensity vocabularies are finalized with the TTS choice; exact provider values belong in the adapter.

Jev returns evaluations of this plan or bounded alternative selections, with source metadata. A deterministic policy handles unsupported/uncertain results. Jev is not required to regenerate the plan's text.

### SynthesizedAudio / ActualAlignment

Generated `asset_id`, actual media properties, applied controls, unsupported controls, optional actual-alignment units with timing source. Keep requested controls separate from applied controls. Distinguish provider timing from alignment estimates.

### TurnRecord / Error

- TurnRecord: `session_id`, `turn_id`, input asset/document references, reply draft/plan, output asset/alignment references, `playback_completed`, stage outcomes. Memory does not assume a generated response was heard before playback confirmation.
- Error: `code`, `stage`, safe `message`, `retryable`, `request_id`. Omit provider authorization headers, raw credentials and sensitive payloads.

## Tentative HTTP boundary

To be finalized in M02, not a live API yet:

- `POST /api/sessions`: create a local conversation.
- `POST /api/sessions/{id}/turns`: multipart audio plus client request ID, bounded complete-turn request; validate at intake. Reject conflicting in-flight requests. Use request ID to avoid silently duplicating billed work on client retry.
- `GET /api/assets/{asset_id}`: serve a known media asset without exposing file paths.
- `POST /api/turns/{id}/playback-completed`: idempotently record playback completion.
- `GET /api/health`: availability only, never environment values.

No live audio sockets or automatic endpointing. If real provider latencies require background jobs, discuss that change separately rather than adding an unplanned queue framework.
