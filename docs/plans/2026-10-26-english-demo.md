# English recording experience

- [x] Translate the fallback React UI, accessibility labels, progress, errors, charts, evidence and sample questions. Done: recording flows read naturally in English on desktop and mobile.
- [x] Translate deterministic backend presentation and require English model-written messages without changing numeric calculations or source references. Done: new live runs produce English conclusions, evidence, explanations and follow-ups; existing Chinese questions remain accepted.
- [x] Add README.en.md and a copy-ready teammate handoff with config placement, commands and recording sequence. Preserve the Chinese README.
- [x] Run unit/typecheck/lint/build, fixture browser checks and focused live English Why/follow-up checks. Review and merge locally; no additional push without a new explicit request.

Verification: 156 unit tests, fixture and live English browser flows, and the public HTTPS UI passed. See [verification](../english-demo-verification.md). The running API now serves English presentation. This revision is merged locally; a new push requires explicit authorization.
