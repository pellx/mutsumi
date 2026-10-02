# M02 whole-original audio contract and Gemini adapter acceptance (2026-10-03)

Implementer: ChatGPT-authenticated Codex CLI gpt-6-luna. Supervisor reviewed and independently exercised the resulting sources. Application source commits on main: cfb3a21 (whole-audio-ports.ts), a0632aa (ohmygpt-whole-audio.ts). Each file was committed separately immediately after its write; task documents also have separate commits. No push.

## Accepted structural and transport scope

WholeAudioAnalysisPort receives StoredAudio and returns separately labelled original_mix scene descriptions, audible features, bounded sound candidates and uncertainties. Matching asset/model provenance is validated; timing is explicitly unavailable. No transcript is merged into the whole-scene result. Domain validation rejects invented timestamps/confidence, extra fields, duplicate event IDs, oversized strings/arrays/UTF8 budgets, unsafe object/array shapes and mismatched assets. Results are cloned independently.

The independent relay adapter forks the previously accepted transcription transport and leaves that adapter unchanged. Endpoint is https://api.ohmygpt.com/v1/chat/completions, model gemini-3.8-flash. Google provenance is an asserted upstream label behind the relay, not independently proven upstream identity. Shared cancellation/deadline covers audio read, Blob bytes, fetch and bounded response streaming. Limits remain 30 seconds, 10MiB audio and 1MiB response. Single request, no fallback or retry; schema excludes transcript, times and scores. Raw provider content is not returned in errors.

Supervisor checks against MAIN source:

- .runtime/qa/whole-audio-contract-checks.mjs: 42/42 passed; results preserved alongside script.
- .runtime/qa/whole-audio-transport-checks.mjs: 26/26 passed. Includes strict result rejection, model/finish/refusal/tool checks, cancellation/deadline, noncooperative fetch and late-body cleanup. These are synthetic transports, not audio quality acceptance.
- Bundled Node24.19.0 + node_modules/typescript/bin/tsc -p tsconfig.json: passed. Initial sandbox dist write denial was resolved through approved project-output execution; no source changes to bypass checks.
- Bundled Node --test tests/acceptance/*.test.mjs: 287/287 passed, 19 suites, zero failures. Log .runtime/qa/whole-audio-regression.txt.

CLI evidence is retained in ignored .runtime/harness-runs/whole-audio-worker/harness-runs, including unsuccessful no-write anchor attempt and successful contract/adapter runs. Copied files were SHA256-compared before worktree cleanup.

## Live pilot and limitations

Owner explicitly permitted provided audio cloud processing (D37). Two owner recordings produced four HTTP200 responses in the bounded second pilot: original whole analysis followed by isolated-vocals transcription for each. Private raw/results/usage are retained under data/acceptance/owner-fumo and owner-wardrobe, run002. See M02-owner-two-audio-pilot.md.

Transport/live result-shape accepted; scene/transcription semantic quality remains owner_review_pending. Whole model made environment/demographic guesses and described wardrobe BGM as instrumental despite the owner's vocal-BGM label. These are candidate descriptions and are not facts or accepted emotion measurements. Existing header comment retains historic fork wording; live evidence is this review, not that header. Production combined context, sequence orchestration, sentence acoustic boundaries, character onset inference and timed input emotion are still unwired. This delivery does not establish complete M02 acceptance.
