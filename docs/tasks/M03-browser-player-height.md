# Browser native player visibility repair

Edit ONLY apps/web/public/styles.css once, then stop; no other tracked/ignored changes, no Git, .env, data or .runtime reads. Qwen3.8-Flash implements via the supervising harness. Read current CSS and docs/architecture.md plus voice-system-flow.md (preloaded). No provider changes.

Supervisor independently reproduced a material rendering defect in sandboxed Edge: after a completed locally mocked round with real human input, #original-audio has bounding box width814 height0; #assistant-audio likewise lacks visible controls. Current audio CSS declares height:auto, so native audio controls collapse. Set a suitable explicit native player height (54px) while retaining display:block;width:100%;max-width:100%, margins and responsive behavior. Do not hide controls/replace audio with custom player or change app.js/HTML. Keep [hidden] overriding display. Minimum acceptable visual controls height40px at1280/736/320 widths with no horizontal overflow. This is layout only, no timeline changes.

One physical tracked-file write maximum, including any partial/truncated write. Prevalidate intended CSS in memory; write once; read-only review and report exact diff. Supervisor runs the real browser check and commits exact file. Do not edit a second time or run private acceptance scripts.
