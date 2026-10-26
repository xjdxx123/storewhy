# Recording polish verification — 2026-10-26

This change adds three reproducible English recording conversations, fixes reliability issues exposed by those conversations, and removes repetitive copy from the fallback React UI. API 1.4.0 and its data contracts remain compatible.

## Checks and evidence

| Check                                        | Result                                                                                                     | Evidence                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Unit and integration tests                   | 164/164 passed                                                                                             | [Vitest JSON](../evidence/recording-polish-unit.json)                                                         |
| TypeScript, ESLint, production build         | Passed                                                                                                     | `npm run typecheck`, `npm run lint`, `npm run build`                                                          |
| Real React fixture browser regression        | Passed, including ten investigation/recovery flows, source access and mobile overflow                      | [Browser results](../evidence/fallback-ui-fixture.json)                                                       |
| Protected public HTTPS with UI-only launcher | 9/9 checks passed                                                                                          | [Public browser results](../evidence/shared-ui-public.json), [screenshot](../evidence/shared-ui-public.png)   |
| Partial-cohort UI                            | Visible once with actual October cutoff and 246 excluded users; mobile overflow check passed               | [Coverage check](../evidence/recording-coverage-ui.json), [screenshot](../evidence/recording-coverage-ui.png) |
| Three English live conversations             | 13/13 checks passed in one complete final run (11 supported/limited answers, 2 unsupported CTR boundaries) | [Scenario results](../evidence/recording-scenarios.json)                                                      |

The final full scenario run completed after the fixes. Every run object polled through public HTTPS was checked for complete period end dates and exact inherited objectives. Earlier failed attempts below are retained separately and are not included in its passing total.

The public browser check launches a separate UI process without vendor credentials. It verifies authentication failures, expired/missing configuration, a secret-free client bundle, a real Why, refresh without a duplicate submission, 60 evidence-bound chart points, a channel follow-up using polling, and closing that UI without closing the shared backend. The consolidated source dialog displayed **all 20 rows** returned by its real query, plus SQL. This was exercised from the maintainer computer through the public HTTPS address; it is not proof that the teammate's recording network has already been tested.

The browser fixture check uses self-authored sample data and a scripted model, separately from the live results. It retains checks for unsupported/failed/cancelled investigations, uncertain POST recovery without resubmission, saved defaults, recommendations and clearly labelled sample replay. Its synthetic rendering cases include missing buckets, nulls, negative values, stacked bars and one visible completeness note shared by two charts. These cases are not presented as observed production results.

The scenario verifier submits the exact English text without context patches. It checks dates, cohort mode, 7/14-day windows, paid audience, channels and behavior-only metric exclusions. For supported answers it fetches every referenced Evidence object, requires Zetaris/query IDs and successful NVIDIA model receipts, and compares every reported fact and chart point to the referenced cell. It also checks that scope edits keep the original Why objective, purchaser-rate questions lead with that rate, and the explicit revenue-composition question answers with both components. CTR requests must stop without an answer or evidence. Passing these checks does not establish ad causality or an optimal budget allocation.

## Bugs found and fixed

- English `Focus on`, `Switch to`, `Use 7 days` and supported month-comparison follow-ups could be treated as new investigations, replacing the original Why objective. These scope edits now retain it; explicit `Keep` clauses protect dates, channels, windows and metrics.
- A stricter end-date audit found that an English “October” request was shortened to the cost-data cutoff. Whole English months now receive the existing full-month protection; explicitly requested submonth/day ranges remain partial. Requested dates and actual maturity coverage stay separate.
- Numeric `7 days` / `14-day` wording and `purchaser rate` now receive the same explicit-constraint protection as their existing aliases.
- An explicit request to split revenue could inherit the preceding spend objective and return a spend-led answer despite querying the right fields. An explicit data request now replaces that objective even when the model labels it `followup`. The report prioritizes first/subsequent purchase components, or purchaser rate, when requested.

Regression tests cover these failures, including deliberately misclassified model intent. SQL, precision rules, cohort maturity and the no-costs-by-device/country restriction were not changed.

## UI review

Removed the brand slogan, promotional hero, repeated composer instructions, redundant completed-progress copy, repeated query-source buttons and duplicate conclusion in key evidence. A source button now opens the full query table, while chart-point sources retain the exact referenced row. The [actual limited-result screenshot](../evidence/recording-limited-ui.png) confirms that a conclusion with an evidence-gap suffix is not repeated as key evidence.

Explanation checks, detailed limits, scope dates/filters and chart notes remain available as disclosures. Actual status, recovery controls, source access, dataset identification and explicit sample labels remain visible. A concise completeness note remains visible when acquisition dates are clipped; it is deduplicated across charts. This preserves material scope information without repeating general caveats throughout the page. Desktop and mobile screenshots were inspected.

## Development failures retained

The successful runs followed fixes and reruns. Earlier failures remain available rather than being counted as successful answers:

- [Initial development run](../evidence/recording-scenarios-development.json): a model timeout, lost objective and answers led by the wrong metric.
- [Later-month retry](../evidence/recording-scenarios-retry-development.json): Zetaris HTTP 400 with `org.apache.thrift.transport.TTransportException`. The local driver had restarted once and later became healthy; Docker reported `OOMKilled=false`. The restart cause was not established. No manual vendor restart or memory-setting change was made in this task.
- [Whole-month audit](../evidence/recording-scenarios-period-development.json): the former start-date/value checks passed, but a public read-back found an exclusive October end of `2019-10-28` instead of `2019-11-01`. The verifier now checks both period ends and exact inherited objectives, including behavior-only and unsupported follow-ups.
- [Relevance development run](../evidence/recording-scenarios-relevance-development.json): all four later-month turns and all four purchasing-behavior turns passed, but the revenue split still retained the old objective. The final direct-query fix and regression test address that failure; the subsequent five-turn [main conversation](../evidence/recording-scenarios-spend-and-revenue.json) passed.

Recordings should be pre-run with the current connection file and services. Live model wording, explanation selections, latency and `completed`/`limited` status can vary. A failed run must be shown or retried deliberately; there is no automatic fallback to sample data. October's 14-day results exclude immature acquisition dates and matching costs, so they are a backup sequence requiring an explicit scope explanation.

## Reproduce

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:ui
npm run test:shared-ui -- --public
npm run test:recording
```

Run live checks sequentially on the local shared Spark driver. The last two commands require the current private connection profile and running Zetaris/Nightshift/NVIDIA services. Do not commit connection files, tokens, original CSVs or runtime state. Copy-ready questions and recommended narration are in [recording questions](recording-questions.md).
