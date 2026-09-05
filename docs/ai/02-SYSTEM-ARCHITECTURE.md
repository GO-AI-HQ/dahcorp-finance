# System Architecture — DAHCorp Finance

## Control chain
Portfolio/account state + market/intelligence evidence → strategic model reasoning → deterministic allocation/risk policy → preview → explicit authorization → broker execution → reconciliation/receipt.

## Core layers
- `src/core/`: pure financial calculations; no financial arithmetic in UI components.
- Risk/policy: deterministic allowlists, account mandates, reserves, notional/exposure constraints and execution gates.
- Broker adapters: Schwab and official Robinhood Agentic Trading MCP, with broker-specific capability boundaries.
- Market/intelligence: Schwab execution-adjacent quotes, OpenBB gateway/research, Finnhub events/reference, FMP income distributions, government/primary sources and other specialist evidence.
- Portfolio State: connected accounts, cash, holdings, verification, sleeves and external liquidity.
- Market/Intelligence State: normalized evidence with provenance/freshness/UNKNOWN semantics.
- Strategy Lab / Modeling Lab: planning and scenario reasoning; never execution pricing.
- Shadow evidence: hypothetical decisions + later outcomes for calibration, not self-granted authority.
- Execution: short-lived/single-use previews, revalidation, explicit confirmation, unknown-submission reconciliation.

## Current baseline boundary
`main` includes through merged PR #32. PR #33 and #34 are open hardening branches and are historical/current proposals, not merged authority. Their snapshot-first data-plane design should be treated as candidate/current-in-progress until merged.