# DAHCorp Finance — Data-Plane Hardening Audit

## Objective

Raise usable data-state success to **95%+** across every existing DAHCorp Finance capability without removing capabilities, weakening deterministic policy, or fabricating missing evidence.

The existing product is the requirements specification. This pass audits the providers already integrated, assigns each data job to the strongest route, adds redundancy and durable snapshots, and fixes current reliability gaps before adding new product capability.

## Target architecture

`Providers -> scheduled/background refresh -> ranked routing + normalization -> durable verified evidence -> Portfolio / Market / Income / Intelligence / Strategy snapshots -> deterministic strategy -> Claude/OpenAI reasoning -> policy validation -> UI`

Interactive page loads should primarily read prepared DAHCorp snapshots. Provider network calls belong in scheduled/background refreshers except where genuinely live evidence is required. Execution-time validation must always recheck current price, cash, risk and eligibility; cached research is never an execution price.

## Provider audit matrix

| Evidence job | Primary | Secondary / fallback | Snapshot / behavior |
| --- | --- | --- | --- |
| Broker holdings, shares, account cash | Schwab / Robinhood account adapters | last verified broker snapshot | Portfolio Snapshot; broker remains authority |
| Current market quotes | Schwab where available | OpenBB, then eligible Finnhub quote capability after audit | Market Snapshot; live recheck before execution |
| Price history / 5D / 30D trend | OpenBB market data | alternate existing market route after capability audit | Market Snapshot |
| Declared dividends/distributions | FMP | OpenBB; reconcile with broker-realized income when available | Income Snapshot; no page-load FMP calls |
| Realized income | broker evidence | declared-distribution providers for context only | Income Snapshot; broker evidence strongest for cash actually received |
| Earnings calendar / estimates / actuals | Finnhub | OpenBB where supported | Intelligence Snapshot |
| Company / market news | Finnhub | OpenBB where supported | Intelligence Snapshot |
| Company reference/profile data | Finnhub | existing reference fallback | Intelligence/reference snapshot; never expands trading allowlist |
| Congressional / lobbying disclosures | Finnhub | specialist/public-source OpenBB lanes where available | Intelligence Snapshot |
| Macro / Treasury benchmark / FRED | OpenBB/FRED route | last verified macro snapshot | Market Snapshot |
| Savings/deposit benchmark | RateAPI | Treasury cash benchmark for comparison, not synthetic replacement | low-frequency snapshot; never page-load dependency |
| Options positioning | OpenBB V3 | last verified V3 lane snapshot | route health and lane population reported separately |
| Short interest / crowding | OpenBB V3 / FINRA route | last verified lane snapshot | Intelligence Snapshot |
| SEC filings / N-PORT / insider evidence | OpenBB V3 / SEC route | Finnhub only where it supplies the same evidence class; otherwise last verified | Intelligence Snapshot |
| Energy supply / positioning | OpenBB V3 / EIA/CFTC | last verified lane snapshot | Intelligence Snapshot |
| Shipping / ports | OpenBB V3 / IMF PortWatch or existing specialist route | last verified lane snapshot | Intelligence Snapshot |
| Fund holdings / look-through | OpenBB V3 / filings route | last verified lane snapshot | Intelligence Snapshot |
| Government/public-money signals | OpenBB V3 + Finnhub disclosure routes | whichever valid source is freshest/highest authority | Intelligence Snapshot with provenance |

This matrix is an initial routing hypothesis. The implementation audit must validate actual endpoint availability, quotas, latency, evidence quality and existing code behavior before changing provider precedence.

## Existing UI / downstream capability inventory

The hardening pass must preserve and support:

- Overview portfolio state and income momentum
- Self-funding milestone math
- Income-producing capital and Income Cash Queue
- Upcoming Income
- Income Ideas / dynamic research candidates
- Possible Portfolio Changes / strategy mutation proposals
- Rotation Rule
- Growth core and tactical cards, including waiting/watch/eligible states
- Market Pulse and 5D/30D interpretation
- Household Liquidity and protected reserve
- Strategy Lab projections and target/contribution controls
- OpenBB/Finnhub/FMP/RateAPI/provider diagnostics
- V3 eight-lane deeper intelligence
- Claude specialist-analysis evidence context
- OpenAI Treasury Strategist evidence context
- deterministic policy, Shadow/human approval and future bounded-execution gates

## Durable snapshot layers

### Portfolio Snapshot
Accounts, holdings, shares, cash, household liquidity, mandates, verification/freshness metadata.

### Market Snapshot
Current verified prices, historical trend windows, benchmarks, macro and market-state evidence.

### Income Snapshot
Distribution history, broker-realized income, projected income, self-funding calculations, upcoming income, candidates and retained last-known-good evidence.

### Intelligence Snapshot
Finnhub/OpenBB/V3 evidence with provider, source class, event time, discovered time, freshness, confidence/quality and lane state.

### Strategy Snapshot
Current Growth, Income, Shipping and tactical decisions plus the evidence basis used to derive them.

### Strategy Basis Snapshot
Stable inputs required for Strategy Lab so contribution/target sliders can recalculate locally and immediately without provider or server round-trips. Server recalculation remains available when the underlying basis changes.

## Reliability semantics

Each data job must distinguish:

- provider configured/connected
- route reachable
- request successful
- evidence returned
- lane populated
- snapshot persisted
- snapshot fresh/stale
- fallback used
- no evidence has ever been observed

A healthy route is not the same as a populated lane. A temporarily empty provider response must not erase previously verified evidence. When current evidence is unavailable, show last verified evidence plus its age unless policy requires current data.

No single optional research provider failure should cause an entire page to return 502.

## Current known gaps to resolve

1. OpenBB V3 options route can be healthy while the stored V3 fabric still reports only 1/8 lanes live. Reconcile route results into durable lane state.
2. Audit and restore the remaining V3 lanes: options, short interest/crowding, earnings, shipping/ports, filings/insiders, fund holdings/look-through, energy supply/positioning, government/public-money moves.
3. FMP must recover cleanly after quota reset and scheduled warm while staying inside the hard daily budget. Browser/page requests remain cache-only.
4. Finnhub is currently broader than the UI's green earnings count: reference data, earnings, market/company news, congressional disclosures and lobbying are already integrated. Audit Finnhub against every compatible evidence job and use it as redundancy where appropriate.
5. Market Pulse should retain last verified evidence instead of oscillating to unavailable on transient provider misses.
6. Self-funding calculations must remain stable through temporary provider gaps.
7. Strategy Lab must retain latest-request-wins behavior and move to local calculations from a durable Strategy Basis Snapshot.
8. Diagnostics must clearly separate provider health, route health, lane population, cache age and fallback state.
9. Claude and OpenAI must receive the same durable, provenance-rich evidence fabric rather than depending on whichever providers answered during an interactive request.

## Provider ranking criteria

Rank each provider **per evidence job**, not globally:

1. authority for that datum
2. correctness / evidence quality
3. freshness
4. observed success rate
5. quota and cost
6. latency
7. historical depth
8. normalization complexity
9. terms/operational suitability
10. ability to support deterministic provenance and audit

## Refresh policy baseline

Final cadence is provider/quota dependent, but the hardening audit starts with these classes:

- broker holdings/cash: frequent background refresh appropriate to broker limits
- market quotes: roughly 5–15 minutes during market hours where quota permits
- price history/trends: scheduled/cache-oriented
- earnings/news/intelligence: roughly hourly where provider terms and quotas permit
- distributions: daily scheduled refresh
- RateAPI savings benchmark: twice weekly/cache-oriented
- specialist filings/macro/shipping/government datasets: aligned to publication cadence

## Success measurement

Build an observable reliability scorecard over repeated refresh cycles. For every required capability record:

- success / usable state
- primary provider attempted
- provider actually used
- fallback level
- request/refresh latency
- snapshot age
- error class
- whether UI remained usable

Initial acceptance target: **>=95% usable states across 100 refresh cycles for each required capability**, excluding correctly classified genuine no-data conditions. Critical broker/account and deterministic-policy paths should target materially higher reliability.

## Implementation sequence

1. Inventory current UI/API dependencies and all provider calls.
2. Produce the validated provider-to-evidence routing table and identify redundant/duplicate calls.
3. Define common snapshot envelope, freshness and provenance semantics.
4. Persist/serve Portfolio and Market snapshots.
5. Persist/serve Income and Strategy Basis snapshots.
6. Persist/reconcile Intelligence/V3 lane snapshots.
7. Route interactive UI reads to snapshots and remove unnecessary provider calls from page paths.
8. Feed Claude/OpenAI from the same snapshot fabric.
9. Add provider/fallback/reliability telemetry and 95%+ scorecard.
10. Run repeated failure/quota/stale-data tests and tune routing/cadence.

## Non-negotiable invariants

- Do not remove an existing capability to make reliability numbers look better.
- Do not fabricate missing evidence.
- UNKNOWN remains distinct from zero/false.
- Last-known-good evidence must carry age/provenance and may not masquerade as live.
- Broker authority and deterministic policy remain authoritative where applicable.
- Model recommendations never bypass deterministic policy or self-approve execution.
- Cached research is never used as an execution price.
- Provider redundancy must reduce fragility, not create uncontrolled request fan-out.
