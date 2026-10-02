# M02 onset final review corrections

ONE file tools/local-aligner/character_starts.py. Read only target and onset_result.py. Previous repair left two task requirements unresolved. Minimal three substitutions in memory then ONE Set-Content write. Stop after actual AST check using EXACT C:/Users/anpel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe (not Python313, not bare python), -X utf8, read utf-8-sig. No private files/environment/model inference/Git.

1. Add lexical_key to existing from align import list.
2. Inside candidate status validation, reject not lexical_key(text) as input_invalid before inference/model. Punctuation-only unavailable entries may remain preserved, but candidate cannot be punctuation-only.
3. In build_views native_valid, remove reconstructed upper-bound comparison `(sentence_end_ms-sentence_start_ms)/1000`. Millisecond-rounded endpoints cannot establish exact raw crop duration. The onset mapper already rejects invalid_start_time/rounded_outside_sentence using actual frames and their reasons are checked. Keep raw finite, >=0, raw monotonic and onset clip-coordinate sentence bound checks. Do not introduce fake crop duration or weaken mapper reason checks.

Preserve all other code. Supervisor will independently verify seven review cases, mocked raw/rounded edge and real saved-results view equivalence. Only one write and syntax check, no claim tests done.
