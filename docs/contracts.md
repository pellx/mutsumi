# Provider-independent contracts — v0.1

The M01 input annotation subset below is implemented and independently tested. Dialogue, synthesis, storage and HTTP sections remain proposals, not implemented APIs.

## Shared conventions

- JSON field names use `snake_case`; persisted documents carry `schema_version: "0.1"`.
- Times are integer milliseconds relative to the associated audio asset's start. Never mix input and output clocks. Require `0 <= start_ms < end_ms <= duration_ms` when times are present.
- Timing is a discriminated object: available carries `status: "available"`, `start_ms`, `end_ms`, and `source`; unavailable carries only `status: "unavailable"` and a nonempty `reason`. Do not use null boundaries, zero placeholders or evenly divide sentence durations.
- Identify assets by server-generated IDs; browser/API clients do not submit filesystem paths.
- Provider status distinguishes `ok`, `unavailable`, and `failed`; empty detected-events plus `ok` differs from an unsupported detector.
- Numeric scores retain their source and semantics (`probability`, `confidence`, `ordinal`, or `uncalibrated_score`). Only a distribution expressly defined as exclusive should be required to sum to one.
- Domain schema validation applies to model outputs before they reach TTS or storage.

## Main documents

### AudioAsset

Exactly `asset_id`, `media_type`, `duration_ms`, `sample_rate_hz`, `channels`. Duration is a positive safe integer; sample rate/channels are positive safe integers or explicit null. Media type must be a nonempty audio subtype. Metadata validation alone does not inspect file bytes. Intake must later verify actual format rather than trust browser MIME. Storage/normalization references belong in separate internal records, not additional AudioAsset keys.

### AnnotatedAudio

`schema_version`, `asset_id`, `transcript`, `segments`, `observations`, `capabilities`.

- Transcript segment: `segment_id`, `text`, optional `speaker_id`, `timing`, optional `units`. Each unit has `text`, `granularity` (`word` or `character`) and `timing`. Measured units must fit within a measured parent interval; gaps and overlaps are permitted. Do not relabel a multi-character provider word as independently timed characters.
- Observation: `observation_id`, `kind` (`emotion`, `prosody`, `sound_event`), `label`, `timing`, `source_provider`, `source_model`, optional `score: {value, semantics}`, optional `segment_ids` referencing existing segments. IDs are unique within each collection. Missing scores remain absent.
- Capabilities has exactly `word_timing`, `emotion`, `prosody`, `sound_event`. An ok capability requires provider/model provenance. Unavailable/failed requires reason and may carry partial provenance. Measured units require word_timing ok; observations require the corresponding capability ok.
- Observations may overlap. Emotions are candidate interpretations, not asserted internal states of the speaker.
- Large audio/feature tensors are stored as assets, not embedded into text prompts. Context builder selects the relevant textual summary and references.

### M01 public API and validation

`apps/server/src/domain/annotation.ts` exports `validateAudioAsset`, `validateAnnotatedAudio`, `parseAnnotatedAudio`, and `serializeAnnotatedAudio`. Validators accept unknown input and return `{ok: true, value}` or `{ok: false, issues: [{path, message}]}`. Parser rejects malformed JSON/runtime non-string input; serializer validates and throws a field-path error for invalid data. No coercion, mutation, score normalization, emotion inference, or fabrication.

Only ordinary own-data-property records (including null-prototype records) and dense ordinary arrays are supported. Unknown keys, symbols, accessors, non-enumerable record fields, array extras and custom prototypes are rejected. Accessor getters are not invoked. This is a JSON-oriented data boundary, not a guarantee against arbitrary hostile JavaScript Proxy traps.

Time values are provider-reported/estimated intervals with provenance, not physical ground truth. A unit's duration is derived as `end_ms - start_ms`; no additional stored duration field is accepted. Generated reply plans cannot claim measured timing before audio exists.

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
