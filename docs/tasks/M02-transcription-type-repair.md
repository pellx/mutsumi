# Repair transcription adapter types

Edit ONLY apps/server/src/providers/ohmygpt/ohmygpt-transcription.ts, exactly once. Read only that file and application/input-stage-ports.ts. No other source or discovery. No .env, providers, private data or launchers. Required docs preloaded.

Supervisor has committed the draft and independently reproduced two TypeScript errors. Fix constructor parameter from nonexistent OhMyGptAudioAnalysisConfig to OhMyGptTranscriptionConfig. Replace broad Observation[] annotation for mapped sound events with UntimedTranscription['sound_events'][number][] so kind remains sound_event. Remove unused Observation type import. No runtime behavior changes, no formatting/rewrite of unrelated lines. Use one Node in-memory replacement with anchors verified exactly once, piped directly from a PowerShell single-quoted here-string to node. No nested shell.

After sole write run node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json and node --input-type=module -e "import('./apps/server/src/providers/ohmygpt/ohmygpt-transcription.ts').then(m=>{if(typeof m.OhMyGptTranscription!=='function')throw Error('missing adapter');console.log('import verified')})". Check actual exit/output. Stop so supervisor commits before further edits. Implementer is configured gpt-6-luna.
