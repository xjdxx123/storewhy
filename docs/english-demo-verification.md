# English recording verification

Verified on 2026-10-26 with the actual fallback React application and the existing Zetaris/Nightshift/NVIDIA integration.

- **Unit tests:** 156/156 passed. Existing Chinese questions remain in the regression suite. Added English source-cell binding and reversed-premise checks using isolated self-authored fixture data.
- **Static checks:** typecheck, lint, build, Prettier and `git diff --check` passed. A scan of 48 changed/new text files found none of the six private vendor/sharing values.
- **Fixture browser:** ten investigation/failure scenarios passed, including refresh recovery, recommendation execution, saved defaults, cancellation, unsupported metrics, offline model, uncertain submission, explicit replay, chart edge cases and mobile layout.
- **Live browser:** eight real scenarios passed: main Why after refresh, FaceBoom, seven-day scope, temporary fourteen-day scope, saved-window recovery, a recommended follow-up, cancellation and missing CTR data. Main Why completed; some follow-ups were limited and their state was retained. All 60 main chart points matched actual Evidence cells. The English page and evidence dialog contained no Chinese presentation text. There were no browser console errors or mobile document overflow.
- **Public HTTPS UI:** eight shared-backend checks passed after updating the running API. Anonymous/wrong-token requests were denied, a UI process without vendor configuration completed real Why and FaceBoom follow-up, all 60 chart points remained bound, refresh created no duplicate question, and the browser made no SSE requests or exposed sharing token. The full rendered main page was English.

Evidence: [unit report](../evidence/english-unit.json), [fixture UI](../evidence/fallback-ui-fixture.json), [live UI](../evidence/fallback-ui-live.json), [public HTTPS UI](../evidence/shared-ui-public.json), [English public screenshot](../evidence/shared-ui-public.png).

The first browser attempt waited on a remaining Chinese test selector. The selector was updated; the failure is recorded separately in `evidence/english-ui-selector-development.json` and the corresponding screenshot. Historical renderer failure artifacts were preserved. Visual review also caught a missing space in the English headline, which was fixed before the public UI verification.

Review checked the translated metric definitions, observation caveats, cohort maturity disclosure, source references, executable follow-up scopes, errors/progress and sample disclosures. Numeric calculations, SQL and metric IDs were retained. English natural-language output is requested in the existing structured model prompt. The English reversed-premise recognizer extends the existing Chinese protection and has its own source-backed regression test.

The API on port 3100 was restarted only after confirming no active investigation, and the existing protected sharing connection remained usable. Old stored reports keep their original text; the English UI uses a separate local conversation key so it starts a new English session. Teammates should replace no vendor keys and should pre-run once on their own device before recording.
