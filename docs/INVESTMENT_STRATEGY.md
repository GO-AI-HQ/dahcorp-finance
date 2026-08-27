# Investment Strategy

The strategy this application exists to operate, and where each rule lives in
code. Every number quoted below is a **default**, editable in Settings and
stored per-user. Nothing here is hard-coded doctrine.

---

## 1. The thesis

Build a high-cash-flow portfolio until it purchases assets with its own
distributions, then progressively redirect that cash flow into long-term growth.

The portfolio is a machine that buys assets. Contributions start the machine; the
machine's own output eventually does the buying. The measure of success is not
the value of the account, it is **how much the portfolio buys per month without
external money** — see the Self-Buy Ratio below.

That is why the application is organised around income *and* capital
preservation, not yield alone. A distribution funded by returning the
investor's own capital moves cash without creating wealth.

---

## 2. Accounts

| Broker | Account | Role | Phase 1 |
|---|---|---|---|
| Robinhood | Active Accumulation | Weekly income accumulation | Priority |
| Charles Schwab | Income / Value / Cyclical | Income + value + cyclical | Priority |
| Schwab | Roth IRA | Long-term compounding | Display only |
| Schwab | Education / Coverdell | Education capital | Display only |

The two taxable accounts drive Phase 1. Retirement and education accounts are
displayed when data is available but are marked `allocationEligible: false`, so
the risk engine blocks any recommendation or order against them
(`ACCOUNT_NOT_ALLOCATION_ELIGIBLE`) and treats them as a separate risk sleeve.

Seeded positions are the observed starting point, not an assumption of
ownership: Schwab 11 YMAG, Robinhood 7.90 NVDY. Legacy Schwab fractions in TSM,
CCJ and SOXL may exist and are represented as such. **A watchlist ticker is not
a holding** — the universe (`src/core/universe.ts`) and the holdings list are
separate concepts throughout.

---

## 3. The cash-flow engine

Opening allocation: NVDY and YMAG, weighted `{ NVDY: 0.5, YMAG: 0.5 }` in
`incomeAllocationTargets`. This is an **opening position, not a permanent rule**.
The opportunity ranker continuously tests whether a different mix better serves
the monthly-income objective, and the weights are replaced wholesale when
settings are saved.

### Income is not one thing

`src/core/distributions.ts` separates:

- **distribution income** — what a derivative-income ETF pays
- **dividends** — corporate profit distributions
- **return of capital (ROC)** — the investor's own capital coming back
- **realized gains** / **unrealized gains**
- **NAV appreciation / depreciation**
- **total return** — the only complete measure

A distribution is **never** reported as pure profit merely because cash arrived.
Where an ROC percentage is reported, the app shows *economic* income net of ROC
alongside cash received; where ROC is not reported, economic income is `null`
rather than assumed to be zero. A position whose NAV is eroding faster than it
distributes is flagged, not celebrated.

### Cash-Flow Efficiency Score

`src/core/cashflowEfficiency.ts` ranks candidates on cash produced per invested
dollar over 4 / 13 / 26 / 52 weeks, plus payment stability, trend, NAV
preservation, total return, ROC share, drawdown, spread, liquidity, volatility,
correlation, overlap and concentration.

**Investments are never ranked by advertised distribution yield.** A fund with
the highest headline rate can and does rank below one with a lower rate but
better NAV preservation and total return, and the ranking always states why.

---

## 4. Self-Buy Ratio

The engine's most important metric: how many shares the portfolio buys with its
own distributions, per week, month and year.

```
monthly_distribution_per_share = avg_weekly_distribution × 52 / 12
monthly_self_buy_ratio         = total_monthly_distribution / current_share_price
required_shares                = current_share_price / monthly_distribution_per_share
required_shares_weekly         = current_share_price / avg_weekly_distribution
```

Implemented in `src/core/selfBuy.ts`. Prices and distributions are always read
from live snapshot data — **never hard-coded**.

### Self-funding micro-milestone

The first meaningful threshold is the point where each position's weekly
distribution buys one more share of itself. At observed prices around $11.12
(YMAG) and $12–13 (NVDY) this lands near 32 YMAG and 31 NVDY, roughly $735–750
combined. **Those figures are an illustration of the current market, not a
permanent fact.** They are recomputed on every snapshot and shown as progress
bars against the live requirement.

---

## 5. Income targets

Ladder: **$150 → $500 → $1,000 → $2,500 → $5,000** per month
(`MILESTONES`, active milestone default `B` = $500).

Objective: about $500/month within 24 months; stretch case around 12.

```
required_capital = desired_monthly_income × 12 / modeled_distribution_rate
```

The capital requirement is *derived*, never presented as a fixed dollar figure —
at a lower modeled rate the same $500/month needs materially more capital. The
modeling basis is user-selectable (latest declared, 4 / 13 / 26 / 52-week
average) with a conservative haircut (default 25%), and the required-capital and
ETA figures move with it. Illustrative contribution figures for 12 / 18 /
24-month deadlines are solved from live data by
`solveMonthlyContribution` (`src/core/projection.ts`), not stored.

---

## 6. Liquidity reserve

Default **$10,000**, user-configurable. Reserved cash is excluded from
`investableCash` at the portfolio layer and re-checked in the risk engine, so it
can never be recommended or spent. If total cash falls below the reserve the app
raises `RESERVE_UNDERFUNDED` and rebuilding the reserve becomes the priority
ahead of any purchase.

---

## 7. Strategy levels

| Level | Name | Goal |
|---|---|---|
| 0 | Prove the Engine | Reach ~$150/mo; validate that the strategy compounds economically, not just in cash received |
| 1 | Build the Engine | Reach ~$500/mo; full reinvestment |
| 2 | Bifurcate | Split distributions between compounding the engine and buying growth |
| 3 | Capital Production | The portfolio finances growth, the semiconductor core and future education capital |

The level is derived from sustainable monthly income
(`strategyLevelFor`). At Level 2 the split is configurable
(`bifurcationReinvestShare`, default 0.5) and is modeled explicitly in the
projection engine — bifurcation slows income growth and buys growth exposure,
and the simulator shows both effects.

---

## 8. Semiconductor engine

**Permanent cores:** TSM and SMH — accumulated, held long-term, never harvested.

**Tactical leveraged sleeve:** TSMX (≈2× daily TSM) and SOXL (≈3× daily
semiconductors).

> 2× or 3× **daily** leverage is not 2× or 3× long-term return. Daily reset and
> volatility decay are modeled explicitly (`estimateVolatilityDrag` in
> `src/core/semiconductor.ts`), which compares the leveraged product's realised
> path against its de-levered equivalent.

### Harvest rules (defaults, configurable)

| Instrument | Trigger | Harvest | Destination |
|---|---|---|---|
| SOXL | +25% from tactical cost basis | 25% of position | SMH |
| TSMX | +20% from tactical cost basis | 25% of position | TSM |

A harvest converts a tactical gain into permanent core, which is the flywheel:
leverage is a means of accumulating unleveraged compounding assets, not a
position to marry.

### Leveraged risk cap

`maxLeveragedSleevePct` (default 10%) bounds SOXL + TSMX combined. Claude cannot
recommend a purchase that pushes the sleeve past it — the risk engine reduces or
blocks the order (`LEVERAGE_LIMIT_REDUCED` / `LEVERAGE_LIMIT_BLOCK`) and says so
in the preview. Raising the cap requires an explicit configuration change by the
investor.

---

## 9. Trend confirmation

Trend status is **calculated, not judged**. `src/core/signals.ts` evaluates
20 / 50 / 200-day moving averages, RSI, drawdown from recent high, volume
behaviour, relative strength and benchmark trend, then reports one of:

- `TREND_CONFIRMED`
- `TREND_WEAKENING`
- `TREND_LOST`
- `INSUFFICIENT_DATA`

Claude may interpret and explain these signals. Claude may not decide that a
leveraged asset has "lost trend" — the checks that produce the verdict are
deterministic and testable, each one reported individually with its own pass or
fail. In Phase 1 a `TREND_LOST` verdict produces a risk reduction
*recommendation*; nothing executes automatically.

---

## 10. Dip engine

Dip levels default to −5% / −10% / −15% / −20% measured against a configurable
anchor: 60-day high, 52-week high, 50-day MA, 200-day MA or fair value.

A dip is only reported as *actionable* when trend and momentum still hold.
**"Price declined" is not the same as "asset is undervalued"** — a decline
accompanied by broken trend or failing momentum is labelled a risk event, and
the rationale says which of the two the app thinks it is looking at.

---

## 11. Corporate actions

Splits, reverse splits, ticker changes, mergers, delistings and cash-in-lieu are
applied through `src/core/corporateActions.ts`: price history and distribution
history are adjusted, share counts and symbols are updated, and cost basis
totals are preserved.

Consequently **a raw historical share count is never the goal**. Milestones are
expressed in income and in shares required *at current prices and current
distributions*, recomputed continuously, so a 1-for-10 reverse split does not
silently redefine the target.

---

## 12. Where the numbers come from

Every calculation in this document lives in `src/core/`, is pure and
side-effect-free, and is shared byte-for-byte between the browser, the Netlify
Functions and the test suite (`tests/`, 272 tests). No financial arithmetic
is performed in a component.
