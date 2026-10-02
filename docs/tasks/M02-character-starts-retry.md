# M02 onset implementation retry: reliable single write

Continue original docs/tasks/M02-character-starts-worker.md requirements (read that task now). Same ONE target tools/local-aligner/character_starts.py, same permitted three source files, no private paths. Prior two attempts made NO file. Supervisor logs prove both writes/checks exit1; never claim creation on failed tool.

Use PowerShell Set-Content with a single-quoted HERE STRING, no nested Python triplequoted source or nested shell invocation. Author Python source using SINGLE QUOTES for Python string literals wherever possible, avoiding doublequote escaping corruption. Avoid regex dollar anchors: use re.fullmatch for IDs. Draft <=30000characters, prefer <12000. One write only then stop if failure. Do not inspect a nonexistent target.

Bare python is unavailable on this computer. For read-only AST check use absolute executable C:/Users/anpel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe with -X utf8 and source read encoding utf-8-sig. Or use bundled Node if easier, but AST Python is required. Check actual exit_code=0 and printed syntax ok before claiming passed. No py_compile/cache/model run. Do not change harness/config/proxy/permissions.
