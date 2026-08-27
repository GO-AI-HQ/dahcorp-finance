# Roadmap

Eight phases. Each one is gated on the previous one being *observably* true, not
merely built. Phase 1 is what this repository contains.

---

## Phase 1 — Foundation & Observer *(this build)*

**Goal:** a complete, deployable dashboard that measures the strategy correctly.

- [x] React + TypeScript + Vite SPA, Netlify Functions backend
- [x] Pure calculation core in `src/core/` shared by browser, functions and tests
- [x] Seeded positions: Schwab 11 YMAG, Robinhood 7.90 NVDY, legacy fractions
- [x] Distribution engine separating income, ROC, NAV change and total return
- [x] Cash-Flow Efficiency Score and opportunity ranking
- [x] Self-Buy Ratio and the self-funding micro-milestone
- [x] Income milestones, required capital, contribution solver, ETA
- [x] Goal simulator with Conservative / Base / Aggressive scenarios
- [x] Semiconductor engine: cores, tactical sleeve, harvest rules, volatility drag
- [x] Deterministic trend and dip framework
- [x] Deterministic risk engine with no override path
- [x] Broker adapter interfaces (Robinhood, Schwab), read-only, mock by default
- [x] Claude recommendation interface with deterministic fallback
- [x] Trade preview; execution endpoint stubbed and audited
- [x] Passcode authentication, session timeout, logout, audit log
- [x] 272 tests over the financial and policy core
- [x] Nine views, mobile-responsive, mock data labelled throughout

**Exit criteria:** deploys to Netlify, all tests pass, no secret in the
repository, every number on screen traceable to a tested function.

---

## Phase 2 — Real Data

**Goal:** the numbers are the investor's actual numbers.

- Schwab Trader API read integration (accounts, positions, transactions)
- Robinhood positions via the official agentic/MCP surface, or `manual` mode
- Live market data provider behind `MarketDataProvider`
- Real distribution history, including reported ROC percentages
- Corporate-action feed applied to history and holdings
- Historical portfolio-value series persisted daily
- Reconciliation view: broker-reported vs computed, with a variance alarm

**Exit criteria:** the dashboard's totals reconcile to both brokerage statements
to the cent, and `containsMockData` is false in production.

---

## Phase 3 — Analyst

**Goal:** Claude's judgement is worth reading.

- Claude analysis over real history rather than seeded data
- Opportunity ranking across a wider income universe
- Recommendation quality tracking: what was advised, what was done, what happened
- Weekly written review, delivered rather than requested
- Drift detection against `incomeAllocationTargets`
- Alerts: NAV erosion, distribution cuts, trend loss, harvest armed

**Exit criteria:** three months of recommendations logged with outcomes, and a
measurable answer to whether following them beat the deterministic baseline.

---

## Phase 4 — Paper Trading

**Goal:** prove the execution path without money.

- Simulated fills at realistic prices with spread and slippage
- Shadow portfolio tracked beside the real one
- Full order lifecycle exercised through the adapters, `placeOrder` still stubbed
- Attribution: contribution vs distribution vs market movement
- Backtest of the harvest rules against real semiconductor history

**Exit criteria:** the shadow portfolio has run for a full quarter with no
unexplained divergence between intended and simulated outcome.

---

## Phase 5 — Approval Mode

**Goal:** the investor can act from the dashboard, deliberately.

- APPROVE / REJECT / EDIT on every previewed order
- Edits re-validated from scratch — an edited order is a new order
- Encrypted server-side storage for broker OAuth refresh tokens
- Per-account `tradeEligible` gating, taxable accounts only
- Second confirmation for leveraged and above-threshold orders
- Complete pre- and post-trade audit trail

**Exit criteria:** an order goes from recommendation to broker acknowledgement
with a human decision recorded at every step, and the kill switch demonstrably
stops it.

---

## Phase 6 — Automated Cash Flow

**Goal:** the flywheel turns without manual work.

- Automatic DRIP tracking and distribution-funded purchases within limits
- Recurring contribution automation
- Milestone transitions, including the Level 2 bifurcation split
- Tax-lot tracking, wash-sale awareness, ROC basis adjustment
- Estimated tax reserve on distribution income

**Exit criteria:** a full month of distributions reinvested per policy with no
manual intervention and no risk finding overridden.

---

## Phase 7 — Limited Autonomy

**Goal:** bounded, pre-authorised action.

- Pre-authorised action classes (e.g. "reinvest distributions per targets")
- Hard per-action, daily and weekly notional limits
- Mandatory human review above any limit
- Automatic suspension on anomaly, data-quality failure or reconciliation break
- Autonomy explicitly scoped per account, never retirement or education

**Exit criteria:** six months of Phase 6 with zero policy violations, and every
autonomous action reproducible from the audit log.

---

## Phase 8 — Capital Production

**Goal:** the portfolio funds objectives beyond itself.

- Multi-objective allocation: income engine, growth, semiconductor core, education
- Withdrawal modeling and sustainable-distribution analysis
- Education-capital planning with a separate risk sleeve
- Long-horizon planning across accounts and tax treatments
- Full performance attribution and tax reporting

**Exit criteria:** sustained monthly income above the $1,000 milestone, funding
allocations the investor did not need to deposit for.

---

## Not on this roadmap

- Options strategies beyond holding derivative-income ETFs
- Margin
- Crypto
- Any unofficial or reverse-engineered brokerage API
- Multi-user or multi-tenant operation
- A public or shareable version of this dashboard
