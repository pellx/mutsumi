# M02 worker: reject empty native alignment

ChatGPT-authenticated gpt-6-luna implementer. ONE write only to tools/local-aligner/align.py; its prior repair is already individually committed. Read only that target. No other edits, Git mutations, environment inspection, .env, data/, .runtime/, network, dependencies, model inference or provider calls. Keep existing task behavior and public CLI unchanged.

Supervisor structural verification passed all mocked cases except empty native items. map_alignment currently sets invalid=True then returns (mapped, diagnostics); for an empty list diagnostics=[] and run's if invalid check treats the empty list as valid. It emits status ok with zero units for a nonempty spoken transcript. Reject an empty native item list explicitly by raising WorkerError('invalid_alignment', a static brief message, []) before the loop; retain the empty raw diagnostic list honestly. No fabricated sentinel units.

Also ensure finite timestamp checks occur before integer rounding in the valid numeric branch: do not call round(float('nan')*1000) or round(inf*1000). For non-finite numeric values, map_alignment should return the full JSON-safe native diagnostic list as it does for other invalid spans instead of relying on a later generic exception wrapper. Preserve raw tags, all unit order/text, lexical checks and the existing complete failure status.

Make the minimal two repairs in memory, assert required anchors before exactly one target write. Do not repair/format/rewrite again after that write. Run only the requested ast.parse in-memory syntax check and stdlib-only --help. No py_compile or test files. Report checks and stop; supervisor immediately commits and repeats the failed/related acceptance cases.
