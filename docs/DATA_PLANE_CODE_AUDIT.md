# DAHCorp Finance — Runtime Data-Plane Code Audit

Status: PR34 working audit

This file records what the current code actually does before the hardening cutover. It is intentionally descriptive: no capability is removed because a current route is inefficient or partially populated.

## 1. Interactive portfolio hot path

`netlify/lib/context.mts::buildServerContext()` currently performs the expensive composition path on request:

1. load strategy config
2. load stored position source
3. construct Robinhood gateway / broker adapters
4. authenticate and converge live broker account state when configured
5. select Schwab/OpenBB/FMP market provider composition
6. request quotes
7. request historical prices
8. request distributions
9. build the PortfolioSnapshot
10. run deterministic portfolio/income analysis

`netlify/functions/portfolio.mts` and `netlify/functions/income.mts` both call this path during interactive GET requests. This is the main architectural target for the snapshot cutover because an external provider timeout can currently become page latency or a function failure.

### Hardening action

Build the expensive evidence state in background jobs, atomically persist the last verified prepared snapshot, and have page endpoints read/recalculate from that prepared basis. Live provider calls remain available for explicit refresh and future execution validation, not ordinary navigation.

## 2. OpenBB current market-data fan-out

`OpenBBGatewayMarketDataProvider` behaves differently by evidence type:

- quotes: one batched `/v1/quote` request for the requested symbol set
- price history: one `/v1/history` request **per symbol**
- distributions: one `/v1/dividends` request **per symbol**

This per-symbol isolation is good for correctness because one unsupported ticker cannot erase every other ticker, but it is expensive inside an interactive page request when the app asks for the entire watch/research universe.

### Hardening action

Keep the symbol isolation in the background refresh layer, persist successful per-symbol evidence, and compose the UI Market/Portfolio snapshots from those stored successes. A failed symbol should retain its own last-known-good evidence without forcing successful symbols to refresh again.

## 3. FMP behavior is already directionally correct

The current `FmpPreferredMarketDataProvider` explicitly calls FMP with `allowNetwork: false` on interactive portfolio/income paths. Network access belongs to scheduled refresh jobs. The persistent FMP cache, 24-hour normal cache window, 429 circuit break, and DAHCorp hard daily budget should remain intact.

### Hardening action

Do not make FMP a page-load dependency again. Fold its stored distribution evidence into the prepared Income Snapshot and report cache age/budget state separately from provider connectivity.

## 4. Finnhub is doing more than one UI card

Current Finnhub code supplies or supports:

- general market news
- company news
- congressional disclosures
- lobbying disclosures
- security/reference registry
- company profiles
- earnings calendar events
- V3 company earnings surprise history

### Important V3 detail

The V3 earnings lane uses the fixed `COMPANY_SYMBOLS` set:

- AMD
- NVDA
- GOOGL
- AMZN
- WMT
- INSW
- CCJ
- TSM

`fetchAdvancedEvidenceFabric()` requests `/stock/earnings` for those eight symbols. Therefore a V3 Finnhub display showing **8 earnings items** can represent those eight company earnings records. That number is independent from the separate **1 of 8 V3 lanes live** coverage metric.

The broader Finnhub earnings-calendar ingestion in `finnhub.mts` is a separate feed filtered against the strategy symbol universe.

### Hardening action

Audit Finnhub overlap requirement-by-requirement. Use it as a secondary/corroborating provider for current DAHCorp requirements where the evidence is semantically equivalent, not merely because Finnhub exposes an endpoint.

## 5. V3 route health vs lane population

V3 defines eight evidence lanes:

1. options
2. fund look-through
3. maritime
4. energy positioning
5. filings / insiders
6. earnings
7. crowding
8. government capital

The scheduled fabric refresh and diagnostics answer different questions.

A diagnostics route check can prove that an OpenBB gateway endpoint responds. A V3 lane is only live when the fabric normalizer receives non-empty usable evidence. If a route succeeds but returns no normalizable rows, the route can be healthy while its lane remains unavailable.

`intelligenceV3Stable.mts` already preserves recent last-good lane evidence as `partial`, never `live`. This is a good reliability rule and remains part of PR34.

### Hardening action

Persist successful V3 composite snapshots into the common Intelligence Snapshot, then instrument each lane with route status, normalized item count, last successful evidence time, fallback/retained state, and failure reason. This is required to resolve cases such as “options route working, options lane unavailable” rather than masking them.

## 6. OpenBB V3 request shape

The V3 fabric currently requests multiple independent datasets:

- options chains for NVDA, AMD, TSM, SMH, SOXL, AMZN, GOOGL, CCJ
- N-PORT look-through for NVDY, YMAG, YMAX, SMH, SOXL, QQQI, JEPQ, SPYI
- PortWatch chokepoints and country port calls
- EIA petroleum and STEO
- CFTC contract search + COT
- SEC MD&A and insider evidence
- FINRA short interest

The shared signed OpenBB client limits process-level concurrency to three and retries common transient gateway/rate-limit statuses once. This should remain, but the hardening layer should stop requiring every lane to succeed during the same refresh in order for prior successful evidence to stay useful.

## 7. Strategy Lab

`strategyLabBasis.mts` already persists a verified income-rate basis and can reuse it for transient misses. However the server simulation path still begins from the broader server context, so the user interaction is not yet fully decoupled from the provider/data refresh path.

### Hardening action

Create the Strategy Basis Snapshot from the prepared portfolio/income state. Then scenario sliders can run deterministic projection math locally/instantly against one stable basis; provider refreshes update the basis asynchronously instead of sitting in the slider loop.

## 8. OpenAI and Claude

Current model paths already consume normalized portfolio/intelligence structures and deterministic policy remains downstream. The hardening objective is not to increase token volume indiscriminately.

### Hardening action

Build model context from the same prepared snapshots used by the UI, with source, freshness, retained/current state and UNKNOWN semantics. This prevents the UI and the models from reasoning over different provider moments.

## 9. First PR34 runtime foundation now added

PR34 has introduced:

- centralized provider-routing contracts
- centralized freshness / stale-usable semantics
- durable atomic domain snapshot storage using the existing JSON settings store
- internal data-plane status reporting without provider calls
- hourly V3 persistence into the common Intelligence Snapshot
- a prepared Portfolio Snapshot builder and scheduled background refresher

The prepared Portfolio Snapshot is not yet the sole interactive source. The next cutover step is to split high-frequency quotes from lower-frequency history/distribution refreshes, verify prepared snapshot population, then move Portfolio/Income page reads off the live provider hot path with last-known-good fallback.
