# M03 separated reply — supervisor acceptance (2026-10-02)

Owner requirement: processed speech plus custom persona and bounded context -> Gemini reply TEXT -> JEV expression emotion. Input-speaker emotion is separate. Decision D30 supersedes the historical combined-draft/optional-Jev path for this new module.

## Delivered scope

`apps/server/src/application/separated-reply.ts` exports injected TextReplyPort and ReplyEmotionPort contracts and generateSeparatedReply. It validates/snapshots the existing asset/annotation/persona/preferences/history input through buildDialogueContext; persona remains owner configuration. Calls text first, then expression with unchanged accepted text and separately cloned context. Each stage retains its own provider/model labels; labels alone do not authenticate the upstream model.

Expression segments must concatenate exactly to the accepted text, including punctuation and spaces. Unknown/unavailable expression has no fabricated segments. Text failure skips expression. Expression failure/cancellation retains validated text. Strict output schemas reject extra properties/accessors and validate intensity/coverage. There are no measured output timestamps, audio synthesis, retries or default mock provider. The shared default deadline is 60 seconds (configurable 1..120000 ms), races uncooperative ports and observes late rejections; external cancellation prevents deferred calls.

## Implementation and review

Application implementer: ChatGPT-authenticated gpt-6-luna Codex CLI, medium effort, workspace-write/unelevated sandbox and approval never. An isolated E:/mutsumi/reply-worker worktree inherited existing allowed workspace grants; no ACL/global proxy/configuration change or unrestricted coding agent. Supervisor committed each individual application-file write immediately, inspected diff, authored only ignored independent QA and task/review docs, and cherry-picked individual commits into main. Local commits: 252765d initial module, a357004 repair task, bc2cdf3 cancellation repair. No push.

First independent acceptance found already-aborted requests threw instead of returning structured text-stage failure. Repair also added checks inside deferred calls and preserved trusted unavailable failures without exposing foreign errors. Import check passed in both Luna invocations. Final main-file build passed using bundled Node24.19.0 and node_modules/typescript/bin/tsc -p tsconfig.json. Existing node --test tests/acceptance/*.test.mjs passed 287 tests/19 suites. Default sandbox first denied test-worker spawn (EPERM); supervisor reran the same local tests outside the parent sandbox, without changing coding sandbox or system permissions.

Independent ignored `.runtime/qa/separated-reply-checks.mjs` rerun against MAIN passed 28 checks; report `.runtime/qa/separated-reply-results.json`. Checks cover ordered ports/persona/exact text, honest unknown/unavailable, text failure skips expression, expression failure retains text, rewritten text/nonfinite intensity/extra properties rejected, blank/overlong text and invalid sources, getter nonexecution, cloned context, pre-abort/microtask abort, both uncooperative stage deadlines, mid-expression cancel, observed late rejection, invalid input/deadlines and safe trusted provider_unavailable reduction.

## Acceptance limits and next step

Accepted as provider-independent application orchestration ONLY. All new tests use explicitly synthetic JSON/ports; they are not a live Gemini/JEV or human-audio quality acceptance. No new real recording, external audio transmission, paid call, artificial timestamps or TTS claim occurred. The prior local forced-aligner results remain available for owner inspection.

Pending owner clarification: whether reply Gemini uses existing OhMyGPT gemini-3.8-flash, and exact JEV project/model/API. Then implement their independent adapters and a processed-input CLI route, configure owner-authored persona/history, and run actual human-recording-derived reply acceptance. New module is NOT yet wired into existing RoundService/NestJS/browser/CLI; historical combined ReplyDraft path remains unchanged. JEV failure must remain visible, not replaced with Gemini-derived emotion. Preserve per-file local commits and migration-only GitHub synchronization.
