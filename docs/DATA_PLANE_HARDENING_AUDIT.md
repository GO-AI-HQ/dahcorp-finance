# DAHCorp Finance — Data-Plane Hardening Audit

Status: ACTIVE — PR33 foundation

## Objective

Preserve every existing DAHCorp Finance capability while making its data plane predictable, redundant, durable, and measurable. The target is >=95% usable-data success across required application capabilities, with a design that approaches 100% through provider routing, durable last-known-good evidence, and failure isolation.

This pass does not remove strategy capabilities or weaken deterministic policy. It changes how evidence reaches the application.

## Target architecture

Providers -> scheduled/background refresh -> normalized evidence -> durable snapshots -> deterministic strategy/calculations -> OpenAI/Claude -> deterministic policy validation -> UI

Interactive page loads should primarily read prepared evidence. Provider network calls should not be required merely to render a page.

Execution remains different: any future execution path must revalidate current quote, cash, account state, and risk immediately before an order. Cached research is never an execution price.

## Snapshot contract

1. Portfolio Snapshot — broker accounts, holdings, quantities, cash, mandates, household liquidity.
2. Market Snapshot — current/last verified prices, 5D/30D history and trend, benchmarks, macro evidence.
3. Income Snapshot — distribution history, realized income where available, self-funding calculations, upcoming income, income candidates.
4. Intelligence Snapshot — news/events, earnings, reference data, V3 specialist evidence and lane status.
5. Strategy Snapshot — Growth, Income, Energy, Shipping and tactical eligibility/decision state plus evidence provenance.
6. Strategy Basis Snapshot — stable inputs required for local/instant Strategy Lab projection changes.

Every durable evidence item should carry provider/source, observed-at/as-of time, stored-at time, freshness state, and whether it is live/current, retained last-known-good, or unavailable-never-observed.

## Provider routing matrix — initial audit

| Requirement | Primary | Secondary / corroboration | Last-known-good | Current hardening issue |
|---|---|---|---|---|
| Broker holdings / quantities / cash | Schwab / Robinhood adapters by account | none may invent broker state | Portfolio Snapshot | page rendering must not depend on a fresh broker round trip |
| Current tradable quote | Schwab where supported | OpenBB; evaluate Finnhub as redundancy | Market Snapshot for UI only | distinguish display quote from execution validation |
| Price history / 5D / 30D trend | OpenBB | evaluate Finnhub overlap | Market Snapshot | Market Pulse sectors can become unavailable |
| Macro / Treasury benchmark | OpenBB/FRED | direct authoritative source where already routed | Market Snapshot | persist successful evidence and age it explicitly |
| Distribution declarations/history | FMP | OpenBB | Income Snapshot + retained distribution evidence | FMP quota exhaustion/warning; never page-load FMP |
| Realized portfolio income | broker evidence when adapter provides it | FMP/OpenBB for schedule reconciliation | Income Snapshot | broker-realized evidence needs strongest provenance rank |
| Earnings calendar | Finnhub | OpenBB where available | Intelligence Snapshot | currently working; persist rather than depend on refresh timing |
| General/company news | Finnhub | OpenBB/specialist evidence where applicable | Intelligence Snapshot | ensure useful events reach strategy/agents without UI fan-out |
| Security reference/profile | Finnhub | broker/OpenBB reference evidence | Intelligence Snapshot | reference registry must not expand trading allowlist |
| Congressional/lobbying disclosures | Finnhub | specialist/authoritative evidence where available | Intelligence Snapshot | audit coverage and freshness |
| V3 options positioning | OpenBB V3 | other configured specialist evidence if legitimate | Intelligence Snapshot | route health works but lane population must persist/reconcile |
| Short interest/crowding | OpenBB V3 / FINRA route | configured corroborating source | Intelligence Snapshot | currently unavailable/incomplete |
| Company filings/insider | OpenBB V3 / SEC | Finnhub where its disclosure endpoints overlap | Intelligence Snapshot | currently unavailable/incomplete |
| Fund holdings/look-through | OpenBB V3 / SEC N-PORT | configured fund source if present | Intelligence Snapshot | currently unavailable/incomplete |
| Energy supply/positioning | OpenBB V3 / EIA/CFTC | configured market evidence | Intelligence Snapshot | currently unavailable/incomplete |
| Shipping/ports | OpenBB V3 / IMF PortWatch | configured shipping evidence | Intelligence Snapshot | currently unavailable/incomplete |
| Savings/deposit rate benchmark | RateAPI | Treasury/cash benchmark for comparison, not equivalent evidence | Market/Household Snapshot | low-frequency only; never page-load dependency |
| AI evidence payload | normalized snapshots + provenance | raw provider evidence only when specifically needed | most recent valid snapshots | OpenAI/Claude should receive breadth without contradictory/stale ambiguity |

## UI capability audit

### Overview / Portfolio
Must remain populated through transient provider failures. Holdings and cash are broker-authoritative; last verified broker snapshot is displayed with age when a fresh broker read is unavailable. Never silently convert UNKNOWN to zero.

### Income
Self-funding, projected income, upcoming income, Income Ideas, Possible Portfolio Changes, cash queue and rotation logic must consume a durable Income Snapshot. FMP network access is scheduled/background only. Broker realized-income evidence outranks inferred market distributions for actual cash received.

### Growth / Energy / Shipping
Cards remain structurally present. Eligibility uses the most recent evidence satisfying freshness rules. Missing current evidence falls back to last verified evidence with age; if no evidence has ever existed, show a genuine waiting/unavailable state rather than fabricate a signal.

### Market Pulse / Market Intelligence
Sector pulse, 5D/30D movement, macro and provider diagnostics read durable snapshots. Provider connection, route health, snapshot population, freshness and lane coverage are separate concepts.

### V3 intelligence
Eight lanes are capability categories, not item counts. A successful V3 route must be reconciled into its corresponding stored lane. Finnhub item counts (for example earnings events) remain independent from 1-of-8 lane coverage.

### Strategy Lab / Modeling Lab
The slider and projection experience should use a Strategy Basis Snapshot so scenario changes can calculate locally/instantly. Slow provider refreshes must not be in the interaction loop. Latest-request-wins remains as a guard for server calculations that still exist.

### OpenAI / Claude
Both reason over the same normalized evidence plane, including provenance, freshness, confidence/quality and UNKNOWN states. Neither model becomes the authority for holdings, quotes, allowlists, risk ceilings, execution eligibility or policy.

## Refresh-class audit

- Broker holdings/cash: scheduled refresh appropriate to broker limits plus explicit refresh where safe.
- Display quotes: approximately 5–15 minutes during relevant market hours, subject to provider limits; last-known-good outside freshness window is visibly aged.
- Price history/trends: periodic market refresh, not per card/page.
- Finnhub news/earnings: periodic background intelligence refresh.
- OpenBB V3: background refresh by lane; successful lane evidence persisted independently.
- FMP distributions: daily scheduled warm under hard daily budget.
- Income discovery: scheduled snapshot, not interactive provider fan-out.
- RateAPI: low-frequency/twice-weekly cache-oriented refresh.
- SEC/FINRA/EIA/CFTC/IMF/specialist publication data: cadence aligned to publication frequency rather than page views.

## Failure semantics

1. Current provider succeeds -> normalize, validate and persist.
2. Primary fails -> try ranked secondary when appropriate and budget-safe.
3. All live providers fail -> serve last-known-good evidence if it exists, including age/provenance.
4. No evidence has ever existed -> explicit unavailable/waiting state.
5. A provider failure must not cause an unrelated page or snapshot domain to fail.
6. UNKNOWN is never converted to zero or a favorable signal.
7. Route health is not equivalent to populated evidence.
8. A populated cache is not equivalent to current/live evidence.

## Success metrics

For each required capability, record across repeated refresh cycles:

- usable-state success rate
- primary-provider success rate
- fallback frequency and provider used
- last-known-good utilization rate
- snapshot age at render
- provider latency/error class
- genuinely unavailable/never-observed rate
- UI render success rate
- AI evidence completeness by required evidence class

Acceptance floor: >=95% usable-data success over a representative 100-cycle hardening test, with no single-provider outage capable of blanking an unrelated application page.

## PR33 implementation sequence

1. Complete provider-to-capability inventory from current code.
2. Formalize provider rank/freshness contracts in code.
3. Introduce common snapshot metadata and durable snapshot boundaries.
4. Move remaining interactive provider calls behind background refresh/cache paths.
5. Reconcile OpenBB V3 route success into persisted lane population.
6. Audit Finnhub capability overlap and add it as secondary evidence where legitimate.
7. Verify FMP scheduled recovery under hard daily budget and clear warning semantics when a valid snapshot exists.
8. Create Strategy Basis Snapshot and remove provider/server latency from slider interaction.
9. Harden page/domain failure isolation and retained evidence behavior.
10. Audit OpenAI/Claude payload completeness/provenance.
11. Run repeated refresh/failure tests and measure >=95% usable-state target.

## Non-regression rules

- No existing UI capability is intentionally removed.
- No provider is removed merely because another overlaps it.
- Provider overlap is used for resilience and corroboration, not silent contradiction.
- Deterministic policy remains downstream of model recommendations.
- Existing FMP hard budget remains enforced.
- Existing V3 lane definitions remain intact.
- Existing broker account mandates remain intact.
- No synthetic financial evidence is introduced to improve availability metrics.
