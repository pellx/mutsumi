# M02 permanent free-gated Gemini transport regressions
Create ONLY tests/acceptance/gemini-audio-analysis.test.mjs once. No other edits/Git/.env/data/.runtime/harness/network or real audio. Qwen primary. Use node:test/node:assert and direct .ts imports of providers/google/gemini-audio-analysis.ts, gemini-audio-result.ts and application/round-errors.ts. Read only public constructor/analyze signatures and mapper schema; not all validatorinternals. Tests inject fake fetch/readAudio, neverglobalnetwork. Key is synthetic-test-key-not-a-secret, input structuralbytes new Uint8Array([1,2,3]) in native Blob audio/wav; asset UUIDv4/duration1000/rate16000/channels1,key==UUID. This is not human/synthesizedspeech or livequalityacceptance.

Known valid payload {transcript:'本地测试。',segments:[{text:'本地测试。',units:[{text:'本地',granularity:'word',start_ms:0,end_ms:400},{text:'测试',granularity:'word',start_ms:400,end_ms:900}],emotion:'平静'}]}. Envelope {model:GEMINI_AUDIO_MODEL,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(payload)}]}]}; Response(JSON.stringify(envelope),headers content-type application/json). StoredAudio metadata independentfixture pertest. Signal freshAbortController, failure via toRoundFailure(error,'analysis').

Meaningful tests prefer14..18:
- exactlyone statelessPOST official interactions URL, redirecterror/keyheadercorrect/model3.8/storefalse/standard/schema/lowthinking4096, inline bytes roundtrip, no tools/agent/previous_interaction/history/background/stream or transcript/assetkeyhints in prompt. Compare expectedpublicschema shape fromexport, notprivatemethod.
- freeTierConfirmedfalse => provider_unavailable BEFOREaudio read/fetch0; preaborted => cancelled noIO; ownedtimedoutpreabort preservescode.
- annotation allwordtext/positivebounds/model-estimate-not-forced-alignment/source/candidateemotionnoscore, prosody/soundunavailable, no rawpayload/privatekey/storage_key.
- wrongmodel/incompletestatus/missingsteps/unexpectedtoolsteps => invalid_result.
- zero/missingtimestamps and lexicalmissingcoverage => invalid_result, no droppedwords/averagedtime.
- multipletextchunks joinedorder, thoughtnotreturned.
- HTTP429 exactlyonecall/provider_failed safe static message; PRIVATE network/HTMLbody never reflected.
- >1MiBbody/advertisedlengthcap => provider_failed; >10MiBaudioblob => invalid_input beforePOST.
- wrongnativeBlob MIME or ducktypedblob => invalid_input beforePOST.
- noncooperativeread/fetch/body deadlines <=50..100ms => timed_out settles; do not use fragile15ms timers or globaltime monkeypatch.
- caller metadata snapshot preserved acrossawait; reader lock released after success/failure; latefetchresponsebody cancelled afterdeadline.
No callback property getters/environment enumeration, no tests weaken failures to pass; cleanupabortedstreams/timers. No source edits iffixture wrong; reportactualfailure. One PHYSICAL targetwrite counts even partial; buildcontentinmemory, shell<30000chars, then node --test tests/acceptance/gemini-audio-analysis.test.mjs andstop regardlessoutcome. Supervisor independentprevious35checks andreal0calls remain truth, notclaimliveintegration.
