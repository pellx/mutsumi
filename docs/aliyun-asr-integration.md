# M02 — Alibaba timed speech analysis boundary

Confirmed on 2026-10-01: qwen3-asr-flash-filetrans, asynchronous REST, enable_words=true, sentence emotion; model-bound Alibaba temporary media upload for the prototype, later owner-managed OSS. This document specifies planned adapters; no live ASR integration has passed acceptance.

## Publication adapter

Input is a validated local audio asset plus an opaque local storage key. Inject the local reader; resolve keys beneath configured data storage, never accept a client filesystem path. Request the Beijing upload policy with GET /api/v1/uploads?action=getPolicy&model=qwen3-asr-flash-filetrans using the server-side coding/account API credential through explicitly configured runtime authorization, not a key embedded in code. The runtime ASR model remains distinct from the coding model.

Validate policy fields before uploading: policy, signature, upload_dir, upload_host, oss_access_key_id, x_oss_object_acl, x_oss_forbid_overwrite, expiry and size limits. Upload multipart data to the policy's HTTPS Alibaba OSS host, with a generated collision-resistant object filename and file last; include the policy's required fields. Do not send the DashScope bearer credential to OSS. Disable redirects and reject unexpected hosts. Return a model-bound oss:// object reference with estimated expiry; the prototype media lifetime is 48 hours, distinct from the short-lived upload-policy credential.

Private local originals and annotations remain in ignored data. Temporary provider objects cannot be independently queried/modified/downloaded by this upload mechanism; do not promise deletion or reuse across models. Own-OSS replacement must preserve the publication contract and explicitly report URL expiry.

## Transcription adapter

POST /api/v1/services/audio/asr/transcription with model qwen3-asr-flash-filetrans, input.file_url and parameters enable_words=true, enable_itn=false, channel_id=[0]. Include X-DashScope-Async: enable; for oss-resource references also X-DashScope-OssResourceResolve: enable. Reject model mismatch and expired reference before billed submission.

Submit exactly once per operation. If submission times out ambiguously, return a safe error; do not blindly create another billed task. Poll the returned task ID with a shared deadline/cancellation signal and a bounded interval. Pending/running wait; failed/cancelled terminate. Success yields output.result.transcription_url; download result promptly (documented URL lifetime 24 hours), without API bearer headers, with bounded response bytes and expected Alibaba result hosts. Never log signed URLs or provider bodies by default.

Map transcripts[].sentences[] to stable local segments. Audio-relative begin_time/end_time are integer milliseconds, distinct from task-level date strings. Map words[] text/timing preserving actual granularity. A multi-character word remains a word, not multiple invented character times. Punctuation may be retained in text but receives no fabricated independent duration. Unit duration is derived end-start.

Sentence emotion becomes a sourced observation referring to its segment; it is not independent emotion recognition for each character. Preserve labels and absent scores. Missing spoken-unit timing fails this initial-version requirement; successful silence is allowed when text/segments are empty. Unsupported prosody and sound-event detection remain unavailable. Validate the mapped annotation with M01 before exposing or persisting it; reject malformed provider JSON instead of coercing it.

## Acceptance

Use synthetic transport fixtures for upload policy expiry/limits, cancellation, model mismatch, submit ambiguity, polling timeout/failure, invalid download and mapping. Synthetic success cannot establish real cloud integration. Then transcribe a short real sample, review text, actual returned unit granularity, intervals, emotion and resource handling. Do not claim per-character precision before observing it. NestJS/browser wiring follows independent adapter checks.

Primary sources checked 2026-10-01:

- https://help.aliyun.com/zh/model-studio/get-temporary-file-url/
- https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference

Endpoint/model changes must be checked against these sources at implementation time. Limits and timeout values are task-level configuration decisions, not fabricated provider guarantees.
