# M03 browser copy and partial-result actions
Edit ONLY apps/web/public/index.html once. Read only that file. No other edit/Git/.env/data/harness/network.
Supervisor review: replace initial mode-banner developer-oriented instructions with neutral '正在载入运行模式和可用能力。' (app.js fills accurate runtime banner); provider-status initial text '可用能力载入中。'. Remove explicit .m4a extension from accept list because intake approves AAC ADTS not arbitraryM4A. Footer product copy '每轮录音结束后开始处理。字词时间保留来源，情绪以片段候选线索展示。' no implementation/secrets/pricing/meta promises.
Move export-button and clear-button out of hidden reply-section into a separate always-present actions section inside main, preserving IDs/types/initial exportdisabled, so partial analysis results can be exported/reset even when dialogue/TTS unavailable. Do not change anyother IDs, data-stage, asset references, no inlineJS/CSS. Preserve reply section for actualreplyonly.
One successful write, verify requiredIDs exactlyonce/noinlineassets, stop. Supervisor browserchecks partialresultactions and runtimebanner stillvisible.

