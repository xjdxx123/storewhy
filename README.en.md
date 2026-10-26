# StoreWhy

[中文](README.md) · **English**

**An evidence-backed growth investigation agent.** StoreWhy investigates changes in acquisition, purchasing and observed channel returns, then carries the investigation through follow-up questions.

Ask why recorded channel spend rose without matching growth in new-user revenue. The Investigator chooses what to check; an independent Reviewer challenges the explanation and can request another query. Conclusions, charts and follow-up actions link to actual values, SQL, metric definitions and query IDs. The model selects evidence; deterministic presentation generates the numerical statements.

The repository includes a TypeScript/Fastify backend, shared contracts and SDK, and a lightweight React/TypeScript UI in `apps/fallback-web`. A separate teammate UI can live in `apps/web`. See [frontend integration](docs/frontend-integration.md), [architecture](docs/architecture.md) and [implementation plan](docs/plans/2026-10-23-growth-investigator-mvp.md).

## Record using an existing shared backend

The recording computer needs **Git and Node.js 22.12+**. It does not need Docker, Zetaris, Nightshift, NVIDIA credentials or a local dataset.

The backend maintainer starts the configured Live backend, then runs:

```sh
npm run share:backend
```

After authenticated public checks pass, the command creates `.state/share/teammate.env`. The maintainer privately sends that file to the teammate. It contains a temporary address, an independent access token and an expiry time, rather than vendor credentials. Analysis requests, results and evidence pass through Cloudflare; the maintainer must authorize that third-party transmission before sharing.

On the recording computer, install dependencies once:

```sh
git clone https://github.com/xjdxx123/storewhy.git
cd storewhy
npm ci
```

For an existing checkout, run `git pull --ff-only`, then `npm ci`. Save the received connection file as **`.env.remote.local` in the repository root**, beside `package.json`. Do not place it in `src`, and check that the filename does not end in `.txt`. It is ignored by Git.

Start the UI with one command:

```sh
npm run demo:ui
```

Open **http://127.0.0.1:5173/**. This command builds and serves only the local UI. The access token is added by the local Node/Vite proxy; it is absent from the browser bundle and browser request headers. Ctrl+C stops only this UI.

Sharing lasts two hours. The maintainer must keep the backend, vendor services, tunnel, computer and network available. A new sharing session creates a new address and token, so replace `.env.remote.local` and restart the UI. The sharing command requires the official [cloudflared client](https://developers.cloudflare.com/tunnel/downloads/); this repository does not distribute that binary.

The shared UI polls the same investigation every two seconds because [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) do not support SSE. Polling does not resubmit questions. Normal local mode retains SSE. Quick Tunnels have no uptime guarantee; preflight the recording on the teammate's own network. Detailed maintainer instructions: [shared backend guide](docs/shared-backend.md).

## Three-minute recording

Pre-run one complete investigation before recording. Start with **New session**, and identify the data as a public teaching snapshot from Procrastinate Pro+.

1. **Main Why:** use the prefilled question: “Why did recorded spend increase in July 2019 versus June, while new users’ revenue within 14 days of first visit failed to keep pace?” Show the paid-channel audience, cohort time basis, real progress, conclusion and channel charts.
2. **Evidence:** select **View source** and show the underlying value, metric definition, SQL and query ID. Close the dialog.
3. **Follow-up:** select **Focus on FaceBoom**, then **Use 7 days**. Show the updated scope, recomputed figures and new evidence. Allow time for actual model responses.
4. **Data boundary:** ask “Why did FaceBoom ad CTR fall in July 2019?” Show that impressions and clicks are unavailable, so the agent cannot substantiate a CTR explanation.
5. **Architecture:** explain that Zetaris executes the analysis, Meterless Nightshift routes NVIDIA inference, and H-MEM retains explicitly saved, source-backed defaults. If time permits, use **Save 7-day default** and **New analysis with saved defaults**.

Keep `limited` results visible: they mean some explanations remain unverified. Do not describe observational checks as proven ad causality. **View sample replay** is explicitly a self-authored, read-only replay and does not call a live Agent.

## Run the whole application locally

Once this computer has Zetaris, Nightshift/NVIDIA and the dataset configured:

```sh
npm run demo
```

This starts the Live API and built fallback UI together. Open **http://127.0.0.1:5173/**. Ctrl+C closes the two application services it owns, while leaving external vendor services running. Existing port owners are preserved.

The launcher checks private configuration, ports, Zetaris queries, model discovery and the main June/July data scope. Model discovery is not proof of successful inference; pre-run a full Why. First-time vendor setup and data import are described below and in the [recording guide](docs/recording.md).

For development, use two terminals:

```sh
npm run dev:live
```

```sh
npm run dev:ui
```

The default API is **http://127.0.0.1:3100**. Vite proxies `/api` and `/healthz`. `STOREWHY_API_TARGET` changes the proxy target. `npm run build` builds both applications; `npm start` runs the built API. `npm run preview:ui` serves the built UI and requires an existing API.

## Live data and model setup

1. Start local Zetaris and Meterless Nightshift using the Hackathon Setup Guide. Connect NVIDIA in Nightshift Providers; keep the NVIDIA key inside Nightshift.
2. Run `npm ci`, copy `.env.example` to private `.env.local`, then configure `ZETARIS_API_KEY`, `ZETARIS_REST_URL`, `ZETARIS_ORG_ID`, `METERLESS_BASE_URL`, `METERLESS_RUNTIME_TOKEN` and `METERLESS_MODEL`. The model must appear in the Runtime `/models` response. The validated model is `nvidia/nemotron-3-ultra-550b-a55b`.
3. Generate separate `STOREWHY_DB_PASSWORD` and `STOREWHY_READER_PASSWORD` values, each at least 20 characters using letters, digits, `_` or `-`. For example, run `openssl rand -hex 24` separately for each value.
4. Set `ZETARIS_DOCKER_NETWORK` to the local driver network, then prepare, import and register the data once:

```sh
npm run data:prepare
docker compose --env-file .env.local -f infra/compose.yaml up -d
npm run data:load
npm run data:register
npm run dev:live
```

Wait for `storewhy-data` to be healthy before importing. It is separate from Zetaris's internal database; the default host port is 55432. Zetaris uses a read-only PostgreSQL account. All online product analytics run through Zetaris; direct PostgreSQL access is used only for import. A remote driver needs a reachable registered data source and cannot use another computer's `localhost` or local Docker service name.

Git does not include credentials, vendor platforms, Docker containers, raw CSV files or imported data. Never commit `.env.local`, `.env.remote.local` or `.state`. `GET /api/v1/integrations` reports data/model connectivity; use real queries and a full investigation to verify operation.

## Fixture development

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The default `fixture` mode uses self-authored test data. `/healthz`, `/api/v1/catalog`, direct analytics and `/api/v1/demo` work without vendor credentials. **Open-ended Agent questions still require a working Nightshift Runtime.** The sample replay is explicitly labelled and is never an automatic fallback when Live services fail.

## Dataset and interpretation

The public Procrastinate Pro+ teaching case uses three files from `https://code.s3.yandex.net/datasets/`:

| File                    |    Rows | Purpose                                               |
| ----------------------- | ------: | ----------------------------------------------------- |
| `visits_info_short.csv` | 309,901 | Visits and first observed channel, device and country |
| `orders_info_short.csv` |  40,212 | Purchase events and revenue                           |
| `costs_info_short.csv`  |   1,800 | Channel-by-date spend                                 |

`data:prepare` downloads and verifies fixed SHA-256 hashes and generates a [manifest](data/manifests/procrastinate.json). Raw CSV files remain in ignored `data/raw/`; redistribution rights have not been established, so they are not bundled. Repository fixtures are self-authored and are not a real merchant's performance.

- The snapshot spans May 1–October 31, 2019. Acquisition/spend data ends October 27; observations extend through October 31. Currency and timezone are unspecified.
- Attribution is the first observed visit, not an ad touchpoint or purchase-time device. Simultaneous records use stable ordering by time, channel, device, country and imported row ID.
- `calendar` measures activity within calendar periods. `cohort` follows acquired users for a complete 7- or 14-day window. The default compares June and July, **paid acquisition channels**, and 14 days. Paid-channel audience does not mean only purchasing users.
- Incomplete acquisition dates and matching spend are excluded together, with excluded users disclosed. End dates are exclusive. Clipped totals must not be described as complete months.
- Amounts retain source precision until aggregation. Purchase event counts differ from distinct purchasing-user counts. First/subsequent purchase revenue differs from new/returning customers.
- Spend exists only by channel and date. Device/country cost calculations are rejected. Organic spend is unavailable. Missing values and zero-denominator ratios return `null`, not zero.
- Day/week/month trends use calendar periods, with Monday week starts. Missing buckets are not filled with zero; lines break across gaps. Active users and purchasers cannot simply be summed across time buckets.
- There are no impressions, clicks, creatives, products, checkout steps, refunds, profit or experimental ad incrementality. The agent provides evidence-backed observational diagnosis, not causal proof or a budget optimization policy.

## Verification

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:live
npm run test:ui
npm run test:ui:live
npm run test:shared-ui -- --public
```

Unit/lint/type/build checks do not require vendor services. `test:live` requires Python 3 for independent reference calculations, plus the configured dataset and Zetaris. Browser checks use Chrome; override its path with `STOREWHY_CHROME`. Live checks use the configured model and consume vendor usage. Run Live suites sequentially to avoid competing for local Spark resources.

Other entry points include `eval:live`, `eval:answers`, `eval:why`, `bench:runtime`, `test:demo`, and the read-only `demo:check`. Sanitized reports and screenshots are stored in `evidence/`; private sessions and memory are stored in ignored `.state/`. The backend is a single-process local MVP, not a multi-instance deployment.

API 1.4.0 includes evidence-bound charts, grounded conclusions, executable scoped recommendations, explanation-check statuses, progress/timing and recovery. See [chart contract](docs/chart-contract.md), [answer contract](docs/answer-contract.md) and [runtime verification](docs/runtime-verification.md). English presentation keeps metric IDs, numeric values, SQL, evidence references and statuses intact. Chinese questions remain accepted; new presentation text is English. Previously saved reports retain their original wording.

## Sponsors and provenance

- **Zetaris** registers the data and executes all online analytics SQL.
- **Meterless Nightshift** routes Investigator and Reviewer inference through its OpenAI-compatible Runtime, retaining the actual provider/model and receipt ID.
- **Meterless H-MEM** persists source-backed defaults, user corrections and investigation summaries with explicit replacement and an audit ledger. The deterministic hash embedding is a reference implementation, not a claim of Chinese semantic search.
- **NVIDIA** supplies the actual inference model through Nightshift.

H-MEM is adapted from Meterless's Apache-2.0 reference module. See [UPSTREAM](packages/hmem/UPSTREAM.md) and [LICENSE](packages/hmem/LICENSE). This project adds metric compilation, integrations, investigation/review orchestration, state and memory adapters, the API, client, UI and verification. Source versions are recorded in [source_versions](setup/source_versions.json).
