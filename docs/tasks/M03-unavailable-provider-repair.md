# M03 unavailable-provider contract repair

Edit ONLY apps/server/src/providers/local/unavailable-providers.ts, one successful replacement, no other file/Git. Read target only; required project context supplied. Supervisor inspection: methods typed Promise currently throw synchronously because async is missing, and the aborted branch throws a plain RoundFailure which round-errors intentionally treats as foreign.

Add async to analyze/generate/synthesize so callers always receive rejected promises. For aborted signal, compute failure=toRoundFailure(signal.reason,stage,signal) then throw makeRoundError(failure.code,stage). Never throw the plain failure object. Keep ordinary provider_unavailable, exact stage, imports, unused input and zero IO behavior. Preassert anchors, one write, npm run typecheck, report. Supervisor independently runs9 cases; no secrets/private data/harness reading.
