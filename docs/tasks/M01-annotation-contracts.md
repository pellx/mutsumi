# M01 — Annotation domain contracts and validation

Status: discussion draft; do not dispatch until stack and contracts are confirmed.

## Goal

Create typed, validated audio annotation documents independent of cloud vendors. This is the first business-code task for DeepSeek after harness validation.

## Prerequisites

- H00 accepted.
- `docs/decisions.md` confirms implementation language and framework/tool choices needed for this task.
- Supervisor confirms the v0.1 fields in `docs/contracts.md`.

## Allowed scope

- `apps/server/src/domain/`
- `tests/fixtures/` (synthetic data only)
- Domain validation tests at paths specified when task is released.
- Minimal package/compiler/test configuration specified by the supervisor when task is released.

Do not write provider adapters, recording UI, a database, `.env`, or alter design documents.

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
