# M03 controller linked metadata and session guard repair
Edit ONLY apps/server/src/api/rounds.controller.ts ONCE; read only this file and application/round-errors.ts if needed. No other edit/Git, .env/data/harness/cloud.
1. Before calling getTurn or markPlaybackCompleted (including persisted getTurnAudio), require sessionId===runtime.sessionId; wrong session throws owned not_found storage. Service already protects mode, but HTTP should reject before any persistence call and uniformly hide foreign sessions. submitTurn keeps its current invalid_input check.
2. sendAsset requires equality of ALL five AudioAsset metadata fields asset_id,media_type,duration_ms,sample_rate_hz,channels with linked record, not only ID/MIME. Nonmatching -> owned invalid_result storage, no bytes served.
3. assertEmptyBody accepts undefined or an empty plain object only; JSON null is invalid.
Preserve routes/signatures/caps/range/timeout/branding and all unrelated content. One successful write then npm run typecheck and stop. <=400lines soft target; no need reformat.

