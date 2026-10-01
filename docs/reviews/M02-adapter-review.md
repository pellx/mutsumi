# M02 adapter review — 2026-10-01

Supervisor: Codex. Implementer: official deepseek-flash through restricted Codex CLI, authorized fallback after Qwen connection failures. Review covers separate analysis ports, Alibaba result mapper, temporary publication and asynchronous transcription transport. NestJS intake/browser orchestration is not delivered.

## Independently executed checks

- `npm run check`: strict TypeScript on five current TS modules and all four acceptance test files; 202 tests passed, zero failed/skipped/cancelled.
- Publication tests: 35 groups. Source repairs addressed multipart object-key separator/host root, policy limits, early configured byte limit, bounded cleanup and response release on invalid clock. Actual temporary upload of a synthetic Chinese PCM WAV succeeded.
- Analysis transport tests: 53 cases across eight suites. First independent run: 50 passed, three foreign-failure isolation cases failed. Source shape-based error trust could leak foreign message/cause and spoof cancellation. Repair 0eda0fd uses private WeakSet identity for internally created failures and explicitly registered mapper failures. Reviewed diff; subsequent full suite passed. No tests were weakened.
- Mapper fixture regression introduced by an extra implementer edit was committed separately and repaired in 36d72c3. The launcher now explicitly permits only one successful write per invocation. Supervisor acceptance is based on actual checks, not implementer reports or inaccurate reported line counts.

## Actual provider exercise

Synthetic sample: locally generated Windows Chinese speech, “你好，今天我有一点累。我们正在测试语音识别。” WAV size 276446 bytes, measured duration 6268ms. This is QA input generation, not the product's selected TTS, and contains no private conversation. Audio and references remain ignored under .runtime/qa and data/qa.

Actual publication succeeded. First transcription call returned invalid_result; its task response was not retained. A second, bounded diagnostic submission saved only private response bodies under ignored data/qa. It completed one POST, one poll GET and one result GET, all HTTP200. No further billed submission is needed to investigate the captured result. API credentials were sent only to DashScope; result download used HTTPS without authorization.

Returned transcript: “你好，今天我有一点累，我们正在测试语音识别。” One sentence, neutral emotion with no confidence score. Nineteen character units, sentence interval 80–5520ms. Seventeen units have positive measured duration. Two occurrences of “我” have begin_time=end_time (1440ms and 3440ms). The current contract requires start<end, so the mapper correctly rejects this payload under its current task specification. No time was stretched, averaged, clamped, or fabricated. Sentence-level neutral on synthetic speech does not establish human emotion recognition quality.

## Acceptance boundary and pending choice

Publication and asynchronous transport are accepted for their defined adapter scope: isolated headers, submit once, bounded status/result bodies, cancellation/deadline/poll limits, safe errors and successful actual transport. The strict mapper passes its specified synthetic checks, but its zero-duration handling prevents this observed live sample from producing an accepted annotation. M02 end-to-end annotation acceptance remains pending.

Owner has been asked whether to preserve positive unit intervals and explicitly mark the two unsupported durations unavailable, or require a separate alignment module before progressing. Do not silently relax the public interval invariant, drop words, or represent zero duration as reliable measured speech. If partial timing is approved, issue separate mapper/test tasks; the existing domain Timing unavailable variant can represent it without inventing endpoints. Keep the original provider result private and reuse it for acceptance.

No milestone push yet: complete live annotation handling and independent acceptance first. Dialogue/TTS providers, persona/memory and output alignment remain separate unconfirmed choices.
