# M01 — Annotation domain contracts and validation

Status: released, source phase, 2026-10-01. H00 accepted; owner approved TypeScript/Node and NestJS backend. Project name: wakaba. Supervisor finalizes the input-annotation subset below; reply and HTTP contracts remain later work.

## Goal

Create typed, validated audio annotation documents independent of cloud vendors. This is the first business-code task for DeepSeek after harness validation.

## Prerequisites

- H00 accepted.
- `docs/decisions.md` confirms implementation language and framework/tool choices needed for this task.
- Supervisor confirms the v0.1 fields in `docs/contracts.md`.

## Allowed scope

- ONLY `apps/server/src/domain/annotation.ts` in this invocation.
- Make exactly one file creation patch and then stop editing. The supervisor immediately commits the file before any next edit. Do not commit yourself: .git remains protected by the sandbox. Suggest a commit message in your report.
- Tests and package configuration will be assigned in separate single-file phases.

Do not write provider adapters, recording UI, a database, `.env`, or alter design documents.

## Concrete source interface

Read AGENTS.md, voice-system-flow.md, docs/architecture.md and docs/contracts.md. Implement dependency-free TypeScript with erasable syntax, runnable with Node 25 type stripping, without NestJS/vendor imports, classes with parameter properties or enums.

Export the following types and functions:

- `AudioAsset`: asset_id and media_type nonempty strings, duration_ms positive safe integer, sample_rate_hz and channels positive safe integers or null when unavailable. MIME must start with audio/. No storage paths or arbitrary vendor payload fields.
- `Timing`: discriminated union. Available is `{status:'available', start_ms, end_ms, source:string}`. Unavailable is `{status:'unavailable', reason:string}`. Available integers satisfy 0 <= start < end <= asset duration.
- `TimedUnit`: `{text:string, granularity:'word'|'character', timing:Timing}`.
- `TranscriptSegment`: `{segment_id:string,text:string,speaker_id?:string,timing:Timing,units?:TimedUnit[]}`. Unit timing must stay inside the segment when both available; do not require intervals to be contiguous or invent them.
- `Score`: `{value:number,semantics:'probability'|'confidence'|'ordinal'|'uncalibrated_score'}`. Finite only; probability/confidence [0,1]. Ordinal/uncalibrated values are finite but need not lie in [0,1] and must retain their semantics.
- `Observation`: `{observation_id:string,kind:'emotion'|'prosody'|'sound_event',label:string,timing:Timing,source_provider:string,source_model:string,score?:Score,segment_ids?:string[]}`. Preserve explicit label unknown and absence of scores. Overlap is allowed; do not normalize scores or infer emotion from text. References must exist.
- `Capability`: union `{status:'ok',source_provider:string,source_model:string}` or `{status:'unavailable'|'failed',reason:string,source_provider?:string,source_model?:string}`.
- `AnnotatedAudio`: `{schema_version:'0.1',asset_id:string,transcript:string,segments:TranscriptSegment[],observations:Observation[],capabilities:{word_timing:Capability,emotion:Capability,prosody:Capability,sound_event:Capability}}`. Transcript and segment text may be empty for silence, unit text and all identifiers/reasons/sources must be nonempty. segment and observation IDs must be unique within their respective collections. Observations of each kind require its capability status ok. Any units with measured timing require word_timing status ok. Empty arrays with ok are legitimate; unknown is not equivalent to unavailable.
- `ValidationIssue`: `{path:string,message:string}`.
- `ValidationResult<T>`: `{ok:true,value:T}` or `{ok:false,issues:ValidationIssue[]}`.
- `validateAudioAsset(input:unknown):ValidationResult<AudioAsset>`.
- `validateAnnotatedAudio(input:unknown,asset:AudioAsset):ValidationResult<AnnotatedAudio>`: validate the asset too; require document asset_id match. Return useful JSON-like issue paths. No coercion, mutation or uncaught exceptions on malformed input (including invalid containers/null, mixed null timing, NaN, Infinity, duplicate IDs, invalid enum).
- `parseAnnotatedAudio(json:string,asset:AudioAsset):ValidationResult<AnnotatedAudio>`: invalid JSON returns an issue rather than throwing.
- `serializeAnnotatedAudio(document:AnnotatedAudio,asset:AudioAsset):string`: validate, throw a safe error with field paths if invalid, then serialize. Preserve valid known fields/metadata through a JSON round-trip. Reject unknown keys throughout the schema rather than silently stripping them.

The timing union is the concrete v0.1 realization of missing-timing conventions, replacing ambiguous pairs of nullable start/end fields. Do not implement reply planning, TTS alignment, HTTP or storage yet.

## This invocation's verification

After the single creation patch, only read the file and optionally run a syntax/import check with Node. Do not install dependencies or create fixtures/tests/configuration. If you notice a defect after writing, report it for a follow-up single-edit task rather than making a second patch before the supervisor commit.

## Behavior

- Represent raw audio metadata, transcript segments, optional word timing, emotion/prosody/sound-event observations and provider capability states.
- Reject out-of-range/reversed times and references to absent segments.
- Accept legitimate overlapping sound events and unavailable timing with an explicit reason.
- Preserve unknown emotion and missing detector support; do not invent labels or confidence values.
- Keep score semantics and provider provenance.
- Parse and serialize the contract without losing these fields.

## Acceptance cases

1. Valid synthetic utterance with transcript, phrase emotion and overlapping laughter round-trips.
2. ASR without word timing yields explicit unavailable timing, not manufactured character times.
3. Unknown/unsupported emotion and sound-event capabilities remain distinguishable from no detected events.
4. Negative, reversed or beyond-duration times fail validation with a useful field error.
5. An observation referencing a nonexistent segment fails validation.
6. Vendor-specific SDK types are absent from domain contracts.

## Required report

Changed paths, commands and actual results, unsupported cases, and any proposed contract changes requiring supervisor review.
