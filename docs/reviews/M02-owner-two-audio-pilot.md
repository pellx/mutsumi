# M02 two owner audio samples: separation and cloud pilot (2026-10-03)

Owner supplied real fumo and wardrobe recordings and explicitly authorized their cloud analysis under D37. Original copies match their provided source bytes. Recordings, transcripts, model raw responses and QA scripts stay ignored; no private transcript is copied into tracked fixtures or sent to the coding model.

| Case | Original SHA256 | Actual decoded frames / sample rate | Actual duration | CPU separation inference |
|---|---|---|---|---|
| fumo | d3d7be300b9afdb4ba639b0b327298e66afd2311b99c47ae235cac71552a4ef3 | 1179648 / 44100 | 26.749387755102042s | 17261ms |
| wardrobe | 661790eded1d763d72d2005132b8018986249d7861ae88e5ea3d4600a6ed1060 | 436608 / 44100 | 9.900408163265306s | 7670ms |

Existing accepted Luna tools/vocal-separator/separate.py ran locally offline with fixed HTDemucs revision/weight hash, Torch2.10.0+cpu FP32, six threads. Whole command wall time including startup: fumo38.1874919s, wardrobe14.0924253s. Stereo vocals/accompaniment preserve actual original frame count; mono16k analysis has427991/158407frames respectively. MP3 header frame estimates differ from actual decoding and were not used to pad waveforms or fabricate clocks. Per-case separation-001/separation.json records exact output metadata/model/backend. No GPU/system/proxy configuration was changed.

## Cloud evidence

Four initial attempted calls failed before HTTP response. Credential-free diagnostics showed UND_ERR_CONNECT_TIMEOUT, and established the supervisor QA process needed the existing configured OHMYGPT_PROXY_URL. A dedicated child environment enabled that loopback proxy; no global routing changes. First failures remain in whole-analysis-001/vocals-transcription-001 and .runtime/qa/owner-two-cloud-summary.json. They do not prove provider receipt or billing.

Explicit supervised rerun, no automatic retries: fixed OhMyGPT gemini-3.8-flash, one original whole analysis then one vocals-analysis.wav transcription per case. All four returned HTTP200, valid model-pinned result schemas and usage. Approximate measured stage wall times: fumo whole14475ms/transcription17297ms; wardrobe whole11824ms/transcription7783ms. Private raw-response.json, result.json and metadata.json are under each case's whole-analysis-002/vocals-transcription-002. Combined private QA context is evidence only, not production wiring.

Local separation was completed before cloud authorization. The pilot consumed its preserved outputs after whole analysis; it does not prove production orchestration newly performed separation after whole analysis. That sequencing is still to be implemented.

## Listening and semantic acceptance pending

Both whole analyses returned music candidates; fumo also returned nonverbal_voice descriptions. Wardrobe whole analysis labelled music instrumental although the supplied case label says vocal BGM. Fumo whole description suggests room resonance while vocal-stage sound candidates describe wind/outdoor ambience. Neither stage's scene/demographic/genre guesses are confirmed. Do not resolve conflicts by choosing a preferred answer or store them as memories. No human reference transcript exists yet; candidate transcriptions are preserved unchanged, with no claimed accuracy score.

HTDemucs separates a general vocal stem, not guaranteed foreground-speaker versus background-singer isolation. Owner should compare original, vocals and accompaniment for lost speech, onset damage, distortion and singer leakage. Prior positive subjective feedback on the earlier sequence sample does not accept these two samples.

Private static QA report data/acceptance/owner-two-listening.html is served by .runtime/qa/owner-two-listening-server.mjs at http://127.0.0.1:8768/ while process remains running. It has six independent audio players plus source-separated candidate results and conflicts. Edge headless loaded6/6 audio metadata with finite matching durations; screenshot inspected for layout. Browser readiness does not establish auditory quality. Evidence .runtime/qa/owner-two-listening-page-check.json and owner-two-listening-page.png.

Sentence bounds, character starts and timed input emotions remain unavailable; no fabricated windows/timestamps, no paid Gemini reply or Jev call in this pilot. TTS custom-timbre comparison remains deferred. Commits stay local.
