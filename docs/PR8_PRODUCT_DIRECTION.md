# PR #8 — Market Intelligence + Product Simplification

## Governing product question

Every major surface should answer:

> **What should I do with my money right now, why, how much, and what happens if I do it?**

DAHCorp Finance keeps the institutional-grade calculations underneath, but the default UI must translate them into plain-language decisions. Technical evidence remains available behind **View evidence** / **Advanced evidence**.

## Information architecture

Primary navigation:

- **Overview** — How am I doing and what matters today?
- **Income** — How do I grow recurring cash flow?
- **Portfolio** — What do I own, what cash is available, and what can I execute?
- **Growth** — Where are the best wealth-building opportunities?
  - **Semiconductors**
  - **Energy**
  - **Opportunities**
- **Intelligence** — What is changing in markets/policy and why does it matter to this portfolio?
- **Strategy Lab** — What happens under different contribution/allocation/market scenarios?
- **Agent** — What is the Treasury Agent recommending and what evidence has it accumulated?
- **Activity** — What has been recommended, previewed, approved, rejected, or executed?
- **Settings** — Mandates, limits, goals, and execution controls.

Legacy `/semiconductor`, `/opportunities`, and `/simulator` routes may remain as compatibility redirects, but they are no longer separate top-level product concepts.

## Plain-language translation layer

Keep the underlying terms in code and advanced evidence, but translate the default UI:

| Engine term | Product language |
| --- | --- |
| Dip actionable | **Buy zone reached** |
| Profit waterfall | **Where trading profits go** |
| Flywheel | **How trading gains build wealth** |
| Leveraged exposure | **High-risk tactical limit** |
| Trend detail | **Market health** |
| Risk posture | **Investment guardrails** / **Safety checks** |
| Drag analysis | **What needs your attention** / **What is slowing your goal?** |
| Income velocity | **Income momentum** / **How monthly income is changing** |
| Sleeve | **Investment strategy** (advanced label may still show sleeve) |
| Exposure | **What your money is actually exposed to** |

A recommendation should use explicit decision language: **BUY, WAIT, WATCH, HOLD CASH, HARVEST, REDUCE, EXIT**.

## Portfolio + Cash Queue

Portfolio is the action center.

Show mandate-specific cash, not one ambiguous pool:

- **Robinhood Growth Cash Queue** — capital the growth/Agentic mandate may use.
- **Schwab Income Cash Queue** — capital explicitly authorized for the income mandate.
- **Other broker cash** — visible for household awareness but not available to the agent unless explicitly authorized.

A deposit is not an instruction to invest.

A recommendation card should explain:

1. decision,
2. why now,
3. recommended amount,
4. why that amount,
5. cash remaining after the action,
6. what evidence supports and argues against it,
7. expected effect on the user's goal,
8. deterministic checks still required,
9. **Strategy Lab** and **Preview** actions.

## Data-quality corrections before live growth experiments

1. **Unknown Robinhood transferred cost basis is not zero.**
   - Do not display market value as unrealized profit because basis is unavailable.
   - Display **Cost basis unavailable / Unrealized —**.
   - Unknown basis must never trigger a tactical-profit harvest.
2. **Cash authority is mandate-specific.** Broker visibility does not equal agent authorization.
3. **Unknown external reserve is not zero.** Display **Reserve status not entered** until explicitly supplied.
4. Every percentage must identify its denominator in plain language.

## Market Intelligence architecture

DAHCorp's defensible advantage is not "seeing public news before the public." It is **reducing interpretation latency**:

**What changed → which sectors/assets are affected → how has this event class behaved historically → what does our portfolio own → do our rules change → is anything actionable?**

Architecture:

```text
PRIMARY SOURCES        FINNHUB             OPENBB
policy / filings       fast market         normalized financial
                       event layer          data infrastructure
       \                  |                  /
        \                 |                 /
                 EVENT NORMALIZER
                        |
                HISTORICAL EVENT ENGINE
                   /                \
          CLAUDE RESEARCH          QUANT
            interpretation      reaction study
                   \                /
                 OPENAI TREASURY AGENT
                        |
              DETERMINISTIC POLICY
                   /            \
           RECOMMENDATION       WAIT
```

### Finnhub — fast event provider

Initial direct DAHCorp adapter should support graceful plan-dependent access to:

- market/company news,
- major press releases,
- news sentiment,
- congressional transactions,
- lobbying activity,
- institutional/ownership signals,
- U.S. government spending,
- company supply-chain relationships.

Unavailable premium endpoints must degrade to `unavailable`, never fabricated data.

### OpenBB — separate data infrastructure

Keep `GO-AI-HQ/OpenBB` isolated from proprietary `dahcorp-finance` while the fork remains AGPL-licensed.

Use a **REST/MCP service boundary**:

```text
OpenBB service
     ↓ REST / MCP
DAHCorp OpenBB adapter
     ↓
DAHCorp Event Normalizer
```

Do not copy substantial OpenBB AGPL code into this proprietary repository. Revisit deeper embedding when the applicable OpenBB components are actually released under the announced permissive license.

### Primary-source policy lanes

Semiconductors:

- BIS / Commerce export controls
- Federal Register
- CHIPS funding/program actions
- SEC/company investor relations
- trade/tariff actions
- Taiwan/geopolitical policy context
- hyperscaler capex and semiconductor inventory cycle evidence

Energy:

- EIA / DOE
- FERC
- NRC
- Federal Register
- OPEC
- sanctions/trade actions
- grid/infrastructure spending
- nuclear and uranium policy
- data-center/electricity-demand growth

## Event normalization — the evidence moat

Every intelligence event should become structured evidence:

- event ID / fingerprint,
- occurred timestamp,
- discovered timestamp,
- source + source class + source quality,
- source URL where appropriate,
- sector,
- event taxonomy,
- affected assets,
- information-latency class,
- policy/market direction,
- severity,
- deterministic market regime,
- portfolio state at event,
- Agent interpretation,
- Shadow recommendation,
- 1-day / 5-day / 20-day outcomes,
- actual investor decision,
- actual outcome.

Historical similarity is **not** probability. Show sample size, dispersion/range, median outcomes, regime differences, and important exceptions.

### Information latency

Signals must disclose how stale the underlying disclosure is:

- real-time / near-real-time,
- delayed disclosure,
- retrospective positioning,
- unknown.

Congressional and 13F-style filings are contextual positioning signals, not contemporaneous trade triggers.

## Sector taxonomy

### Semiconductors

Initial event families include:

- export-control tighten / relax,
- CHIPS subsidy / funding,
- tariff/trade action,
- fab delay / expansion,
- capex raise / cut,
- AI-demand raise / weaken,
- inventory build / clearing,
- Taiwan/security escalation / de-escalation,
- earnings/guidance shock.

### Energy

Initial event families include:

- OPEC production cut / raise,
- EIA inventory surprise,
- FERC approval / restriction,
- LNG capacity change,
- sanctions tighten / relax,
- grid capex,
- nuclear policy,
- uranium supply shock,
- power-demand/data-center demand change.

Energy intelligence watchlist may include nuclear/uranium and broader power assets such as CCJ (Cameco), URA, CEG, VST, XLE, XLU and later approved names. Intelligence watchlists do **not** automatically widen broker execution authority.

## Intelligence UI

Top-level **Market Intelligence** should summarize:

- Semiconductors pulse,
- Energy pulse,
- Market trend,
- Policy risk,
- News pressure,
- Capital Signals,
- Volatility.

Every major event card should show:

- **EVENT**
- **WHAT IT MEANS**
- **HISTORICAL CONTEXT**
- **YOUR PORTFOLIO**
- **AGENT RESPONSE**
- **WHY / HISTORICAL ANALOGS / STRATEGY LAB** actions.

Capital Signals includes congressional disclosures, SEC Form 4 / insider activity, 13F/institutional positioning, Berkshire and other notable public filings, always with disclosure latency.

## Growth

Growth contains **Semiconductors | Energy | Opportunities**.

Opportunities are not displayed merely because a ticker has a good score. An opportunity must explain how the move advances the treasury objective.

Example:

> **SEMI — Qualified accumulation opportunity**
>
> Why it matters: semiconductor core growth exposure.
>
> Why now: price is inside a planned entry zone while market health remains acceptable.
>
> Intelligence: no adverse policy trigger currently overrides the setup.
>
> Treasury impact: deploy a staged amount while preserving most of the Growth Cash Queue for a deeper decline.
>
> **Decision: BUY $X / WAIT / WATCH**
>
> `[View evidence] [Strategy Lab] [Preview]`

## Strategy Lab

Rename Simulator to **Strategy Lab** and connect simulations to actual holdings/recommendations.

Compare:

- Current plan,
- Conservative outcome,
- Agent-recommended strategy,
- user-created scenarios.

Support scenarios based on actual actions, for example:

- Hold Cash,
- Buy SEMI $X,
- staged SEMI + tactical SOXL after confirmation,
- change monthly contribution,
- change DRIP,
- recycle tactical gains into core/income,
- apply a policy-event scenario using historical analog assumptions.

Clearly label every graph line and show impact on:

- monthly income,
- portfolio value,
- milestone timing,
- contributions,
- DRIP,
- tactical profits recycled,
- remaining Cash Queue.

**Use this strategy** changes the active plan; it does not execute trades. Any required orders move to the Portfolio action queue for preview/approval.

## Decision loop

```text
INTELLIGENCE
    ↓
GROWTH / INCOME OPPORTUNITY
    ↓
STRATEGY LAB
    ↓
AGENT RECOMMENDATION
    ↓
PORTFOLIO + CASH QUEUE
    ↓
PREVIEW
    ↓
SHADOW / HUMAN-CONFIRMED / LATER BOUNDED EXECUTION
    ↓
OUTCOME
    ↓
AGENTIC EVIDENCE MATURITY
```

The deterministic risk engine remains the final authority throughout PR #8. Robinhood live execution remains off unless separately and explicitly armed after Shadow validation.