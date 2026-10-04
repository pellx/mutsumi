# Detailed audible affect and tone (2026-10-04)

Owner requests finer emotion analysis, specifically tone, grounded in psychology/linguistics or mature public implementations. Existing coarse neutral label is insufficient to describe ordinary expressive conversation. This delivery extends input observation, not Gemini persona or Jev reply expression, and never infers diagnosis, enduring personality, intent or private inner feelings from voice.

## Research and engineering choice

Russell (1980), A circumplex model of affect, DOI10.1037/h0077714, uses pleasure/arousal dimensions; engineering adaptation uses ordinal perceived valence/arousal with unknown, not a validated psychological test or calibrated continuous score. Original article: https://doi.org/10.1037/h0077714 ; author-uploaded record https://www.researchgate.net/publication/235361517_A_Circumplex_Model_of_Affect .

Scherer/Banziger SpeechProsody2004 distinguishes affect/prosody issues and studies F0 contours; https://www.isca-archive.org/speechprosody_2004/scherer04_speechprosody.html . Gobl/NiChasaide2003 investigates voice quality communicating emotion/mood/attitude: https://doi.org/10.1016/S0167-6393(02)00082-1 . These support separating audible delivery from categorical emotion; no simple one-feature-to-one-feeling rule is assumed.

GeMAPS (Eyben etal2016), DOI10.1109/TAFFC.2015.2457417, a researched set of prosodic/excitation/spectral voice descriptors, is implemented by openSMILE: https://audeering.github.io/opensmile-python/ and https://github.com/audeering/opensmile . It extracts acoustic features, not automatic psychological truth. emotion2vec official implementation https://github.com/ddlBoJack/emotion2vec offers pretrained representations and nine-class emotion2vec+ (including neutral/unknown). Our inference: merely changing to this categorical classifier does not satisfy detailed conversational-tone descriptions. These are references, not installed dependencies, guarantees of best quality, or claims that our feature vocabulary is a formal standardized scale.

Selected implementation extends already chosen OhMyGPT Gemini audio observer in ONE request. No new model/download/cloud destination. Existing E disk about522MB free, librosa/numpy/scipy/soundfile present but openSMILE absent; no heavyweight installation. Detailed ordinal descriptors are model-perceived audio impressions, NOT measured Hz/dB/rate. A future explicit local acoustic-measurement layer may support validation; do not fabricate its existence.

## Result contract

Legacy EmotionPort/coarse observations unchanged. New provider-independent application/vocal-affect.ts defines optional detailed result field vocal_affect on EmotionResult-compatible return:
- schema_version vocal-affect-0.1, basis perceived_audio, quality owner_listening_pending (owned constants).
- profiles exactly one per existing segment ID, original order, containing old coarse label PLUS:
  status candidate/unavailable; valence negative/neutral/positive/mixed/unknown; arousal low/medium/high/unknown.
  emotion_tags up to3: calm/content/amused/excited/curious/surprised/annoyed/frustrated/angry/disappointed/sad/worried/fearful/uncertain/relieved.
  tone_tags up to3: conversational/explanatory/questioning/emphatic/tentative/playful/warm/reassuring/complaining/detached.
  delivery: pace slow/moderate/fast/variable/unknown; energy soft/moderate/strong/variable/unknown; pitch_variation flat/moderate/wide/unknown; contour rising/falling/level/mixed/unknown; voice_quality up to2 clear/breathy/tense/rough/tremulous/whispered.
  evidence up to9 {dimension,description}; dimension emotion/valence/arousal/pace/energy/pitch_variation/contour/voice_quality/tone; Chinese short description up to160codepoints. At most one evidence per dimension. Every asserted nonunknown dimension/tag/coarse label requires corresponding nonblank evidence, and every evidence dimension must support an actual claim (no irrelevant evidence). candidate requires at least one supported claim/evidence.
  uncertainty up to5 unique noise/music_leakage/overlap/separation_artifacts/too_short/language_uncertain/ambiguous_delivery; Chinese nonblank summary up to180codepoints.

Unavailable is honest: coarse unknown, valence/arousal/delivery scalars unknown, tag/voice-quality/evidence arrays empty, at least one uncertainty. A Chinese insufficient-evidence summary is allowed. No confidence, fabricated intensities, character emotion, new text/timing, psychiatric labels, inferred gender/identity/personality/memory facts. Background and semantic narrative must not decide felt emotion. Tone can reflect how a sentence is delivered, but motives/sarcasm without audible support stay unknown.

Strict schema/validator reject foreign/missing/reordered IDs, extra keys, duplicates, sparse/accessor/symbol/prototype objects, ungrounded claims and placeholder detail. Clone returned profiles. Adapter detailed mode defaults false for old consumers; input CLI --emotion explicitly requires detailed mode true and validates detailed field, matching profile label to coarse observation. No silent fallback to label-only neutral. One request/audio, no retry/fallback. Output JSON persists rich detail before downstream use.

## Delivery and acceptance

Three sequential single-file Luna tasks: independent contract/schema/validator, existing adapter opt-in detailed mode, CLI integration. Every physical tracked write immediately gets one own supervisor Git commit. Independent synthetic provider mocks establish structure only. Build/regressions and CLI checks on final changes; no input alignment/timestamps altered.

Private8770 QA page will display separate summary, tone/emotion tags, valence/arousal, delivery/evidence/uncertainty with escaped text. Existing historical coarse results labelled no detailed analysis; pending new results remain pending, no fabricated rich profiles for real recordings. Sound evidence and interpretation candidates distinct in UI.

Fresh wardrobe cloud acceptance still blocked by prior automatic rejection: direct destination approval remains pending. This request changes analysis design/implementation, not permission to bypass that rejection. Complete reviewable implementation first, then ask specifically owner track to https://api.ohmygpt.com/v1/chat/completions gemini-3.8-flash once. No new seven-clip requests. Owner previously said onset result looks fairly good; preserve that qualitative feedback without claiming comprehensive timing acceptance.