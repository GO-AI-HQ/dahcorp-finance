# PR #9 — Actionable Intelligence, Modeling, and Execution

This document is the implementation source of truth for the post-PR8 review. It preserves the user's review items 1–8 and the follow-up execution clarification.

## Governing rule

Every surface should answer, in plain English:

> **What should I do with my money right now, why, how much, what happens if I do it, and can DAHCorp execute it?**

Only intelligence that is materially relevant to the active strategy should be promoted. Information for information's sake belongs in source detail, not the primary product surface.

## 1. OpenAI runtime

- Fix the OpenAI 401 failure path.
- Keep deterministic fallback, but distinguish authentication rejection from missing credentials, invalid prompt/schema, and provider outage.
- Never expose API keys or provider response bodies.
- OpenAI remains Treasury Strategist; Claude remains Research Analyst; deterministic policy remains final authority.

## 2. Market Intelligence UX

Preserve sector split and expand it to:

- Semiconductors
- Energy
- Shipping
- Technology

Primary event UI:

1. **EVENT** — what happened, source, age, primary/secondary status.
2. **AFFECTED** — only relevant assets/strategies.
3. **DAHCorp Strategic View** — explain the consequence for the user's stated goal in ordinary language.
4. **ACTION** — BUY / HOLD / WAIT / DO NOT ADD / SELL / REDUCE / PRESERVE CASH.
5. Three actions on each material card:
   - **Why** — goal reinforcement and evidence.
   - **Historical Relevance** — DAHCorp event database, not a generic article list.
   - **Model Impact** — send a concrete proposed action into Modeling Lab.

Replace vague phrases such as "negative supply-chain pressure" and "first buy zone" with statements that explain the financial consequence.

### Policy Radar

- Position beside the main intelligence feed.
- Every arrow/state must answer "what does this mean for our strategy?"
- Example: `Export controls ↑ Elevated — raises downside risk to advanced-chip holdings; preserve cash until market health confirms an entry.`

### Capital Signals

- Move to a visually engaging lower panel / ticker-style activity stream.
- Normalize congressional, insider, 13F/institutional, Berkshire and similar signals.
- Always show transaction age and disclosure age.
- Retrospective filings are context, not real-time triggers.

## 3. Modeling Lab + Strategy Lab

Keep the original Strategy Lab simple and dynamic. It remains the general current-portfolio planning tool.

Main Strategy Lab graph:

1. Conservative
2. Current
3. Aggressive
4. **Proposed Model** when a recommendation has been modeled

Add a distinct **Modeling Lab** section/page on the Strategy Lab surface for a concrete recommendation or reallocation.

Examples:

- Hold Cash
- Buy SEMI $10
- Buy SEMI $8 + preserve $42 cash
- SEMI $6 + SOXL $4 after confirmation
- Sell/reduce NVDY at a favorable exit and reallocate to YMAG/YMAX/AMZY/MSFO when the expected income objective materially improves
- Change contribution / DRIP / account allocation

Model outputs should quantify:

- effect on monthly income
- effect on $500/month income goal
- portfolio-value trajectory
- milestone timing
- cash remaining
- concentration / tactical risk
- 1d / 5d / 20d historical-event assumptions when applicable

### Adoption and execution

**Adopt as Active Strategy is not merely a preference toggle.**

It should:

1. persist the strategy as the active plan,
2. stage the required transaction legs,
3. run deterministic checks,
4. route each leg to the correct broker/account,
5. create live broker previews when the broker/symbol/side is authorized,
6. require explicit human confirmation while execution mode is human-confirmed,
7. execute eligible confirmed legs,
8. clearly identify any leg that still requires manual execution outside DAHCorp.

Direct buttons such as **BUY / SELL / Purchase Recommended Amount ($X)** use the same preview → deterministic revalidation → explicit confirmation → execution path.

After fills reconcile, Strategy Lab rebases automatically from the new live holdings and the adopted model becomes the new Current path.

## 4. Portfolio

- Portfolio remains Cash Queue + action center.
- Show live broker cost/share and gain/loss when the broker supplies basis.
- If basis is unavailable, say `Cost basis unavailable` and never invent P/L.
- Default Schwab trade-account selection to account ending **3085**.
- Rename/contextualize the top aggregate card as **Growth Treasury Decision** so it is clearly an overall Growth-capital assessment, separate from ticker-level recommendations.
- Show Growth Cash Queue, Income Cash Queue, and non-authorized broker cash separately.
- Recommendations should have direct Modeling Lab and execution/preview actions.

## 5. Income + YMAG strategy

Schwab taxable account ending **3085** is the Income mandate.

Build a clear YMAG/income strategy with the same rigor as Robinhood but a separate funding stream.

Plain-English recommendation example:

> **WAIT on YMAG**
> YMAG still supports the income goal, but the Schwab Income Cash Queue is below the preferred purchase amount. No current market or policy event changes that plan.

The platform is not loyal to NVDY or YMAG; it is loyal to the income objective. Income candidates that materially outperform the currently held benchmark should be evaluated for rotation.

Initial elevation threshold: **+10 cash-efficiency points versus the best currently held income position**.

YMAX, AMZY, MSFO and other qualified candidates can be elevated into the featured Income Opportunity surface as rankings change.

## 6. Growth sectors and account mandates

Growth tabs:

- **Semiconductors**
- **Energy**
- **Shipping**
- **Technology**
- **Opportunities**

Intelligence supports the same four sector lenses.

### Broker/account mandates

- Robinhood Agentic → Growth / capital recycling.
- Schwab taxable ending 3085 → Income / YMAG and qualified income rotations.
- Schwab IRA → Maritime / Shipping accumulation strategy.

The funding streams do not overlap unless explicitly changed in Settings.

### Shipping intelligence

Shipping is a niche specialist sector and deserves a dedicated evidence lane.

Quant/data inputs should include, where accessible/licensed:

- Baltic Dry Index and other freight/rate indices
- tanker/container/dry-bulk/LNG cycles
- oil/gas/LNG/coal trade flows
- vessel supply/orderbook and scrapping
- Red Sea / Hormuz / canal / sanctions disruptions
- Xeneta-style freight indicators when licensed
- maritime policy / shipbuilding / port fees / tariffs
- Windward-type maritime risk intelligence when licensed

Specialist commentary can be ingested as **analyst evidence**, not fact, and must be corroborated before it changes a recommendation. Initial public expert/source set:

- Sal Mercogliano / What's Going on With Shipping
- J. Mintzmyer / Value Investor's Edge public commentary
- Christopher Vonheim shipping interviews

Relevant commentary should be summarized into structured claims, affected shipping subsegment, supporting/contradicting market data, confidence, and portfolio relevance.

### Technology

Technology/AI is a quality-growth / DCA lane for holdings such as GOOGL, AMZN, WMT and later approved assets. It is not automatically a leveraged tactical strategy.

## 7. Opportunities + Overview routing

### Opportunities

Price opportunities must answer `opportunity for what?`

Promote:

- favorable DCA/add-on setups in existing high-quality holdings,
- sector-specific accumulation candidates,
- qualified new holdings only when the expected goal benefit is clear.

For every candidate show:

- objective served
- why now
- buy/hold/wait decision
- recommended amount
- why that amount
- effect on goal
- cash remaining
- Intelligence summary
- Why / Historical Relevance / Model Impact / Preview-or-Execute actions

Keep Advanced Opportunity Scoring and the Dip Engine as expandable institutional evidence.

Translate Dip Engine fields into plain-language explanations of what each threshold/check means and which decision it supports.

### Overview

Do not redesign the central Overview cards.

`What needs your attention` becomes the strategy-routing layer:

Overview → Opportunities → Why → Modeling Lab → Adopted Strategy → Portfolio Action Queue → Execution → Outcome.

The top briefing/data-quality card should evolve into a concise **Treasury Briefing** containing only the most pertinent live items:

- actionable intelligence
- policy/news briefing
- distributions / DRIP
- material portfolio changes
- material data-quality caveats

## 8. Historical Relevance / event moat

Rename all `Historical Analogs` UI to **Historical Relevance**.

Historical Relevance opens the DAHCorp evidence record:

- event class
- number of comparable observed events
- 1d / 5d / 20d outcomes
- medians / dispersion / range where sample supports it
- market-regime differences
- current regime comparison
- affected portfolio assets
- prior Shadow recommendation
- actual prior decision/outcome
- explanation of why the history is relevant to today's recommendation

Underlying event record stores:

- Event ID
- occurred/discovered timestamps
- source/source quality
- sector/taxonomy
- affected assets
- information latency
- policy direction
- severity
- agent interpretation
- market regime
- portfolio state at event
- Shadow recommendation
- 1d/5d/20d returns
- actual decision
- actual outcome

This database is Agentic Evidence Maturity. Event similarity is never presented as probability of recurrence.

## 9. Capitol / institutional signals

Use the forked `GO-AI-HQ/mcp-capitol-trades` as an isolated public-disclosure discovery/research component and AInvest as a structured ticker-level congressional-trade enrichment source.

AInvest environment key is stored in Netlify; never expose it client-side.

AInvest `/ownership/congress` enrichment should capture:

- politician
- party/state
- ticker
- trade date
- filing date
- reporting gap
- buy/sell
- approximate value range

No Apify dependency is required initially.

## Safety boundary for PR #9

- No autonomous/bounded execution is enabled by this PR unless separately armed.
- Human-confirmed live execution may be widened only through explicit code allowlists, broker capability checks, fresh cash/quote checks, single-use previews, exact confirmation, second broker preview/revalidation and mandatory reconciliation.
- Unknown broker submission outcomes are never automatically retried.
- `Adopt as Active Strategy` may stage multiple legs, but each live leg must independently pass broker and deterministic execution policy.
