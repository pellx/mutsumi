# M02/D21 local audio analysis port

Implementer: Qwen3.8-Flash through the restricted Codex CLI harness. The owner's current agreement forbids DeepSeek coding runs, superseding historical fallback wording. Read AGENTS.md, voice-system-flow.md, docs/architecture.md and D21 in docs/decisions.md. Existing architecture text describes Alibaba; D21 is the newly authorized Google input-analysis replacement.

Only writable file: apps/server/src/application/analysis-ports.ts. Make exactly one successful write and stop. The supervisor reviews and immediately commits that file before another edit. Do not run git mutations. Do not inspect .env, data/ or .runtime/. Do not call any cloud service.

Append a provider-independent LocalAudioAnalysisPort type after the current declarations:

```ts
export type LocalAudioAnalysisPort = {
  analyze(audio: StoredAudio, options: { readonly signal: AbortSignal }): Promise<AnnotatedAudio>;
};
```

Explain in its comment that adapters may resolve an opaque local storage key and submit inline bytes under a bounded caller signal. It does not require a signed remote reference or temporary object-store publication. Inputs must already have validated metadata and storage authorization; a browser cannot supply filesystem paths. Timing must preserve explicit provider-estimate provenance, never claim forced alignment, fabricate missing bounds, or invoke a second recognizer silently. Sentence emotion links are not independent unit emotion. Do not modify any existing interface, type, import, or behavior.

Verification: read back the appended declaration; if possible run an in-memory TypeScript check or the existing typecheck command without generating new files. Report the exact modified file, actual checks, limitations and a suggested commit message. Do not claim live Gemini verification.
