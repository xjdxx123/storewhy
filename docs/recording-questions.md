# Recording questions: verified English conversations

Run each group in a **New session**. Paste the turns in order and wait for each result before sending the next. These are natural-language messages, without hidden API patches. Dates refer to new users acquired in the named months; 7/14 days is the purchase follow-up window after first visit.

The groups were exercised through the protected public HTTPS endpoint against **Zetaris and NVIDIA through Meterless Nightshift**. The validation checks the scope after every turn, actual SQL query IDs, model receipts, and every fact/chart value against its source cell. It also checks answer relevance, rather than accepting a successful HTTP status. See [verification](recording-polish-verification.md) and the [machine-readable runs](../evidence/recording-scenarios.json).

## Recommended recording: Group A, turns 1–4

Allow around **three minutes**, including narration and source inspection. The latest measured wait for these four turns totaled about 73 seconds; external services can take longer. Pre-run the sequence on the recording computer and network. Keep the terminal, backend, Nightshift, Zetaris and sharing session running. The connection file expires; request a fresh private file when needed, then restart `npm run demo:ui`.

1. **New session**, then paste A1. Introduce it as a public teaching snapshot from Procrastinate Pro+, rather than production store data. Show the month labels, paid audience and 14-day window.
2. Show **Conclusion**, channel charts and **Key evidence**. Say: “TipTop spent 1,734.60 more, while revenue from the same acquisition cohorts fell by 600.84 within fourteen days.” This identifies an observed mismatch, without proving its cause.
3. Click **View source**. Show the query results table, metric definitions, SQL and query ID; close with Escape. This table retains every returned row, even though duplicate source buttons have been removed.
4. Paste A2. FaceBoom's spend actually **fell by 206.80**, so do not carry the original increased-spend premise into this channel. A `Limited` result retains measured facts but leaves some explanations unresolved. Expand **Explanation checks** or **Data limits** briefly if useful.
5. Paste A3. Show the window changing from 14 to 7 days and the recomputed chart/source IDs. FaceBoom's seven-day revenue increased by **555.48**, while recorded spend fell by **206.80**. Spend is indexed by acquisition dates; shortening the purchase window does not itself reduce channel spend for these fully mature June/July cohorts.
6. Paste A4. Show **Unsupported by this data**. Say: “This snapshot has no ad clicks or impressions, so it cannot explain CTR.” No fabricated CTR chart or stale answer should remain.
7. Close with: “Zetaris executes the data queries. Meterless Nightshift routes NVIDIA inference. Each conclusion links to its evidence.” If there is time, paste A5 to show a supported question still works after an unsupported one.

Do not rely on the exact order or availability of recommended buttons. Pasting the messages below reproduces the tested scope explicitly. **View sample replay** is a labelled self-authored replay, not the live recording path.

## Group A — July versus June: spend, channel, window and data boundary

Use turns 1–4 for the main recording; turn 5 is an optional extension. All June/July acquisition dates have complete follow-up in this snapshot. The first answer highlights TipTop; it does not mean every channel follows that pattern.

### 1. paid-14

```text
Why did recorded spend increase in July 2019 versus June 2019, while new users' revenue within 14 days of first visit failed to keep pace? Use paid acquisition channels.
```

- Expected scope: **2019-06 → 2019-07 · all paid channels · 14 days**.
- Observed status: **completed**; measured wait: **19.8 s**.
- Verified output: TipTop: 2019-07 vs 2019-06, within 14 days of first visit, spend increased by 1734.6 and revenue decreased by 600.84. Higher spend was not accompanied by higher revenue on the same basis.

### 2. faceboom-14

```text
Focus on FaceBoom. Keep the same dates and the 14-day window after first visit.
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 14 days**.
- Observed status: **limited**; measured wait: **19.6 s**.
- Verified output: FaceBoom: 2019-07 vs 2019-06, within 14 days of first visit, spend decreased by 206.8 and revenue increased by 539.42. Further explanation still has evidence gaps.

### 3. faceboom-7

```text
Use 7 days after first visit instead. Keep FaceBoom and the same dates.
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 7 days**.
- Observed status: **limited**; measured wait: **16.3 s**.
- Verified output: FaceBoom: 2019-07 vs 2019-06, within 7 days of first visit, spend decreased by 206.8 and revenue increased by 555.48. Further explanation still has evidence gaps.

### 4. missing-ctr-main

```text
Why did FaceBoom ad CTR fall over that period?
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 7 days**.
- Observed status: **unsupported**; measured wait: **17.7 s**.
- Expected behavior: no answer or evidence is created for missing CTR data; the current scope is retained for a supported follow-up.

### 5. purchase-composition

```text
Split the revenue change into first and subsequent purchase revenue. Keep the same channel, dates and 7-day window.
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 7 days**.
- Observed status: **completed**; measured wait: **11.6 s**.
- Verified output: FaceBoom: 2019-07 vs 2019-06, revenue within 7 days of first visit increased by 555.48; first purchase revenue increased by 234.92 and subsequent purchase revenue increased by 320.56. These are revenue components, not new versus returning customers.

## Group B — August to October: other channels and incomplete follow-up

Use this as the backup when demonstrating additional months and channels. The October turn requires explanation: the requested month remains October, but 14-day completeness excludes acquisition dates on/after **2019-10-18**. In the verified RocketSuperAds result, **246 users** were excluded and channel costs were clipped to the same eligible dates. Do not present it as a full October calendar total or a like-for-like full-month causal comparison. Open **Data limits** and the source coverage.

### 1. tiptop-september-7

```text
Why did recorded spend and new-user revenue within 7 days of first visit change on TipTop in September 2019 compared with August 2019?
```

- Expected scope: **2019-08 → 2019-09 · TipTop · 7 days**.
- Observed status: **completed**; measured wait: **30.9 s**.
- Verified output: TipTop: 2019-09 vs 2019-08, Recorded channel spend within 7 days of first visit changed from 11202 to 13232.5; difference 2030.5, relative change 18.13%.

### 2. rocket-september-7

```text
Switch to RocketSuperAds. Keep September versus August 2019 and the 7-day window after first visit.
```

- Expected scope: **2019-08 → 2019-09 · RocketSuperAds · 7 days**.
- Observed status: **completed**; measured wait: **16.9 s**.
- Verified output: RocketSuperAds: 2019-09 vs 2019-08, Recorded channel spend within 7 days of first visit changed from 253.11 to 218.4; difference -34.71, relative change -13.71%.

### 3. rocket-september-14

```text
Change the window to 14 days after first visit. Keep RocketSuperAds and the same dates.
```

- Expected scope: **2019-08 → 2019-09 · RocketSuperAds · 14 days**.
- Observed status: **completed**; measured wait: **22.7 s**.
- Verified output: RocketSuperAds: 2019-09 vs 2019-08, Revenue within 14 days of first visit changed from 676.8 to 614.78; difference -62.02, relative change -9.16%.

### 4. rocket-october-14

```text
Now compare October 2019 with September 2019. Keep RocketSuperAds and the 14-day window after first visit.
```

- Expected scope: **2019-09 → 2019-10 · RocketSuperAds · 14 days**.
- Observed status: **completed**; measured wait: **17.8 s**.
- Verified output: RocketSuperAds: 2019-10 vs 2019-09, Revenue within 14 days of first visit changed from 614.78 to 320.36; difference -294.42, relative change -47.89%.

## Group C — May to July: purchasing behavior without spend

Use this to demonstrate a different question, rather than another spend story. The May→June rate difference is small, so it makes a weaker opening. No spend, cost-per-user or revenue-to-spend metric should appear in these runs. Rates in the headline are rounded; percentage-point changes are calculated from the underlying precision and may differ from subtracting the displayed rounded rates.

### 1. faceboom-june-7

```text
Why did the first-week purchaser rate for new users differ on FaceBoom in June 2019 versus May 2019? Check user behavior only, without spend analysis.
```

- Expected scope: **2019-05 → 2019-06 · FaceBoom · 7 days**.
- Observed status: **completed**; measured wait: **22.9 s**.
- Verified output: FaceBoom: 2019-06 vs 2019-05, Purchaser rate within 7 days of first visit changed from 11.2% to 11.19%; decreased by 0.02 percentage points.

### 2. faceboom-july-7

```text
Compare July 2019 with June 2019 instead. Keep FaceBoom, the 7-day window and the same behavior metrics. Do not analyze spend.
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 7 days**.
- Observed status: **completed**; measured wait: **49.7 s**.
- Verified output: FaceBoom: 2019-07 vs 2019-06, Purchaser rate within 7 days of first visit changed from 11.19% to 11.76%; increased by 0.57 percentage points.

### 3. faceboom-july-14

```text
Use 14 days after first visit. Keep FaceBoom, the same dates and behavior metrics. Do not analyze spend.
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 14 days**.
- Observed status: **completed**; measured wait: **16.3 s**.
- Verified output: FaceBoom: 2019-07 vs 2019-06, Purchaser rate within 14 days of first visit changed from 11.53% to 12.05%; increased by 0.52 percentage points.

### 4. missing-ctr

```text
Why did FaceBoom ad CTR fall over that period?
```

- Expected scope: **2019-06 → 2019-07 · FaceBoom · 14 days**.
- Observed status: **unsupported**; measured wait: **1.8 s**.
- Expected behavior: no answer or evidence is created for missing CTR data; the current scope is retained for a supported follow-up.

## Re-run before recording

With an active private connection profile on the maintainer computer:

```sh
npm run test:recording
npm run test:recording -- --group=spend-and-revenue
npm run test:recording -- --group=later-months
npm run test:recording -- --group=purchasing-behavior
```

Choose one command; the first runs all groups, the others run a single group. By default the script reads `.state/share/teammate.env`. For a teammate's root-level file, set `STOREWHY_REMOTE_CONFIG=.env.remote.local` in the shell before the command (PowerShell: `$env:STOREWHY_REMOTE_CONFIG=".env.remote.local"`). No vendor credentials are needed on that computer. Do not run load-heavy live checks in parallel on the shared backend.

Each group has its own conversation. The script stops a failed chain and records the error; it does not silently retry a submitted question or fall back to sample data. Output is written to `evidence/recording-scenarios[-group].json`, without sharing credentials. Live wording, selected explanations, latency and `completed`/`limited` status can vary; scope, grounded numbers and data boundaries must remain correct.
