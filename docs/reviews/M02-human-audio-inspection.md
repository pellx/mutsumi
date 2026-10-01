# M02 human-recorded audio inspection

Date: 2026-10-01. Supervisor: Codex. The owner requested publicly sourced real human audio instead of synthesized input, relaxed the strict single-character inspection requirement to tokens/words/phrases, and required future live integration and acceptance to simulate actual use with human recordings. Owner inspection remains pending; no push or next-module implementation follows this delivery.

## Material and provenance

Three original recordings were downloaded from the AISHELL-3 authors' [Dataset Samples section](https://sos1sos2sixteen.github.io/aishell3v2/). That section identifies original 44.1kHz recordings and is separate from the page's synthesis samples. [OpenSLR93](https://www.openslr.org/93/) describes the human-recorded Mandarin corpus and its Apache-2.0 license. The downloaded paths are audios/raw/raw1.wav, raw2.wav and raw3.wav; no synthesis-section audio was used.

The originals are retained under ignored data/qa/human-live/. Copies were converted from PCM16 mono 44.1kHz to PCM16 mono 16kHz, with no trimming or speed change. The same converted waveform was submitted to ASR and embedded for inspection. Exact URLs, original/analysis SHA256 values, sample rates, frame-derived durations and processing descriptions are recorded in ignored data/qa/human-live/samples.json.

| Sample | Analysis duration | Provider units | Inspection groups | Conditional calibration |
|---|---:|---:|---:|---:|
| aishell3-raw1 | 3533 ms | 11 | 7 | 0 |
| aishell3-raw2 | 5105 ms | 19 | 10 | 0 |
| aishell3-raw3 | 2925.75 ms | 9 | 4 | 0 |

These are real human studio read recordings, not natural conversations. They demonstrate human-input operation but do not establish performance with background noise, colloquial hesitation, accents, overlapping speakers or strong emotions. Future usage-condition evaluation must include human conversational recordings covering those conditions. AGENTS.md now records the owner's human-audio requirement. Historical synthetic checks remain historical evidence and are not rerun or presented as current usage-condition acceptance.

## Actual cloud checks

Supervisor executed python .runtime/qa/prepare-human-audio.py and node .runtime/qa/check-human-live.mjs. All three samples passed the production publication/analysis adapters and domain validator. Each received exactly one qwen3-asr-flash-filetrans submission; all 15 policy/upload/submit/poll/result stages returned HTTP200. All 39 spoken units have positive supported time intervals. Text matches the public reference after NFC and punctuation/whitespace normalization; provider punctuation is preserved.

Native timing was valid for these recordings, so no Paraformer calibration was requested. This run validates the native path and correct skip behavior, not the previously reproduced zero-duration repair path. Qwen returned neutral for all three sentences, with original sentence bounds and no confidence score; these labels are provider observations, not human emotion ground truth.

Credentials were read by the supervisor's allowlisted dotenv parser and used only for the approved Alibaba analysis role. Audio and responses were not sent to a coding model. Signed references and raw responses stay in ignored data/. No runtime application source was changed, and no further Qwen or DeepSeek coding task was run.

## Word/phrase inspection boundary

Supervisor executed node .runtime/qa/prepare-human-review.mjs. The display uses Intl.Segmenter Chinese word segmentation and preserves explicitly marked book/song titles as phrases. It merges only complete adjacent provider units; if a lexical boundary falls inside a measured multi-character unit, the group extends to an existing boundary instead of inventing a split. Every group retains its constituent units and exact source.

There are 21 inspection groups, including 英特尔 at 800-1360ms (560ms) and 相思风雨中 at 1040-2640ms (1600ms). A group span is last-unit end minus first-unit start and includes any intervening pauses. It is a derived envelope over model-estimated boundaries, not a new acoustic measurement or the exact vocabulary tokenizer of a Transformer model. Transformer architecture itself does not determine a tokenizer.

Group emotion points to the existing sentence observation, retaining its source and original interval. Copying that reference does not claim independent per-token emotion recognition. Runtime domain/provider annotations retain their actual granularity; the grouping in this delivery is for owner inspection, not new runtime orchestration or an unapproved emotion provider.

## Display verification and delivery status

Supervisor executed node .runtime/qa/verify-human-widget.cjs using local headless Edge with Chromium sandbox enabled. All three recordings loaded with frame-derived durations and played in full. All 21 group selections had exact retained endpoint/duration values, and selected-phrase playback passed. Widths 736 and 320 were checked with no horizontal overflow or page-script errors. Desktop/mobile screenshots were inspected. Evidence is ignored data/qa/human-live/widget-check.json and .runtime/qa/human-review-*.png.

The inline inspection display is self-contained and embeds only the three public recordings and bounded display data. It requires no live HTTP server or network request to play. Originals, ASR responses, annotations and supervisor scripts remain ignored; only this report and the human-audio rule are committed, each immediately in its own commit. Existing application tests were not rerun because no application source changed; the preceding 230-test result is documented in M02-conditional-calibration-acceptance.md. This delivery is ready for owner inspection and does not declare the full M02/NestJS/dialogue/TTS system complete.
