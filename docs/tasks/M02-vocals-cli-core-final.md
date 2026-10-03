# M02 vocals core remaining exact fixes

ONE target tools/analyze-vocals.mjs, read targetONLY. Small runVocalsPipeline corrections only, preserve otherfunctions. Onewrite thenabsoluteNode --check actual0andSTOP. No config/private artifacts/model/tests/Git. Draft in memory/assertanchors thenonewrite.

Supervisor source/tests show core still wrongly requires sd.duration_ms (fielddoesNOTexist). REQUIRED exact logic: after validateSentences, first validate integer sd.clip_frames 1..1920000 and sample_rate===16000,statusok/partial; compute local `durationMs` from actualframes/rate (Python round-even: x, floor, fraction===.5 thenevenfloor elseMath.round); use this computed variable for emotioneligibility, audioasset.duration_ms and ret.duration_ms. NEVERread sd.duration_ms ANYWHERE. DO NOT mutate s or persistedworkerartifact to add field. Actualauto-sentence JSON lacksduration; allrealwardrobe replay blockedbycurrentcore. Declared `durationMs` outsidejobsloop forlateruse.

Preabort: validate caller instanceofAbortSignal BEFOREcalling caller.addEventListener; ifalreadyaborted ctl.abort('cancelled') immediately so nextcheck fails BEFOREanyfs/model/job. Place callerhooksetup insidetry aftervalid signalcheck,cleanup safelyfinally. Noforeignreason printing. Currentaddlistenerbeforecheck causedpreabortstartworker. Optionalcfg key validation: for o.emotionConfig validate bounded nonblankkey<=4096 no NUL/CR/LF, rejectunknown configkeys beyondkey/proxy; no .envlookup forprovidedcfg; thiscurrentcorecfg bypass wasunchecked. Existingruntimeconfignexttask handlesproxy; directexport observertests configsvalidsynthetic-key.

Timing provenance: projection/source comparisons use sd.source (actualQwenmodel source) ratherthan sentence.source||local_sentence_candidate (sentenceitemsdon'thavesource). Preserve frozenstructure.

Requestedemotion ineligible mustresult.partial +exit_code1; localpartial result exit_code0. Set explicit ret.exit_code beforeexclusive result persistence; main respectingthis isnextprocess task. Do notfakefailure bydeletinglocalresults. Onfailure requestedemotion classifytimed_out/cancelled from check/ctl.signal beforefallbackemotion_failed, do notmaskcancel asordinaryemotion error. Remove Promise.race abort listeners onsettle whereeasy (percallfunction withfinallycleanup), ensurehandledlosingpromise.

Avoid incidentalrewrites ofvalidators/main/config. Supervisor recomputes20checks plusactualfreshhumanrun. Syntaxcheckisnotqualitytest. Stop afteronewrite.
