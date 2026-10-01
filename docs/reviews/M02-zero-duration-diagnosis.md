# Zero-duration character diagnosis — 2026-10-01

Owner rejected treating zero-duration characters as an accepted partial result and requested cause investigation and repair. No interval invariant has been relaxed and no fabricated duration has been inserted. NestJS intake work is deferred while this prerequisite is resolved.

## Directly observed evidence

The saved original provider result already contains two lexical 我 units with equal begin_time/end_time: 1440/1440ms and 3440/3440ms. This occurs before local granularity classification. filetrans-result.ts reads and checks these numeric bounds before calling granularityFor; that classifier only labels one Unicode letter/number character versus multi-character word and never generates or rewrites times. Thus the reproduced defect is upstream timestamp output, not local character classification.

Original synthetic input is a valid 22050Hz mono PCM16 WAV, measured 6.267574 seconds (asset bound 6268ms), 276446 bytes; vendor audio_info agrees with its rate/encoding. All original word boundaries lie on an 80ms grid. Sentence text and 19 character units include both 我 characters.

Supervisor performed two bounded diagnostic comparisons using the same selected qwen3-asr-flash-filetrans and synthetic content, with one billed submission per comparison. References and raw responses remain ignored in data/qa; only safe derived evidence is recorded here:

| Input | Result |
|---|---|
| Original 22050Hz mono PCM | 19 units; two zero-duration 我 units; strict mapping rejected. |
| Same waveform resampled to 16000Hz mono PCM | 19 units; two zero-duration 我 units at 1600ms and 3440ms; strict mapping rejected. All boundaries remain on an 80ms grid. |
| Same 16k waveform slowed with FFmpeg atempo=0.5 | 19 units; one zero-duration 我 at 3280ms; strict mapping rejected. Output duration 12444ms, so slowed timing was NOT mapped back as original timing. |

Submission, poll and result download for both new comparisons each returned HTTP200. Normalization did not solve the defect. Slowing also failed to eliminate it and is not adopted as a workaround. The comparisons do not prove that every zero span arises solely from 80ms quantization, or that the source character was silent.

## Relevant upstream mechanism

Qwen's open-source ForcedAligner predicts start/end independently with discrete timestamp classes, then performs a non-decreasing monotonicity correction which permits equal adjacent values. Its parse step can therefore produce a zero-length lexical interval. An issue in the official repository reports the same 我/们 pattern. These establish a plausible mechanism consistent with our output; Alibaba's closed hosted model internals are not confirmed by this evidence.

- Source: https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/qwen3_forced_aligner.py
- Reproduction report, not a maintainer guarantee: https://github.com/QwenLM/Qwen3-ASR/issues/197

## Proposed repair, awaiting joint model choice

Keep the selected Qwen text/emotion path, but validate timing separately. Evaluate an independent original-waveform timing path using Alibaba paraformer-v2 with timestamp_alignment_enabled=true, which the official REST documentation supports. This is a comparison proposal, not a claim it guarantees positive or accurate character intervals. New model use is pending owner confirmation; no Paraformer call or application adapter has been implemented.

Require same lexical content (explicit punctuation-only normalization policy), genuinely supported single-character units, positive ordered bounds inside the original clip, and original-waveform time basis. Only then replace timing using explicit calibration-model provenance. If text differs, characters are grouped without individual timing, or bounds remain invalid, reject rather than split/average/borrow neighboring intervals. Keep Qwen sentence emotion separate; no numerical emotion score is inferred. No unbounded retries or silent double billing. Confirm integration and cost behavior after the comparison succeeds.

Primary parameter reference: https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api
