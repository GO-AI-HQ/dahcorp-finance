# DAHCorp Finance Product Language Standard

DAHCorp Finance should sound like a knowledgeable person explaining money clearly — not like an AI demo, a quant terminal, or an investment-bank research note.

## Default rule

Use plain, natural language first. Technical terms may appear when they are financially meaningful or necessary for auditability, but they should not be the first thing the user has to decode.

Examples:

- Prefer **Market** over **Intelligence** in primary navigation.
- Prefer **Strategist** over **Agent** in primary navigation.
- Prefer **Growth cash**, **Income cash**, **Shipping cash**, or **Savings** over generic capital-allocation jargon.
- Prefer **Keep at least this much liquid** over reserve-threshold terminology.
- Prefer **Help me make the most of this cash** over optimization-engine language.
- Prefer **Waiting for verified income data** over a misleading `$0` when a provider is unavailable.
- Prefer **Waiting for market evidence** over removing a card or implying that a missing signal equals a negative signal.
- Prefer **Route working** for a successful connection check and **Research lane populated** only when usable evidence has actually been stored. Do not use one label for both states.

## Technical details

Technical/provider language belongs in:

- expandable source details,
- audit logs,
- developer/admin views,
- provenance and data-quality explanations,
- compliance and execution safeguards where precision matters.

Examples of acceptable technical terms in those contexts include OpenBB, Finnhub, FMP, FRED, deterministic risk checks, data freshness, execution eligibility, API route, and provider fallback.

## Data gaps

Missing data must read like a normal explanation of what is known and unknown.

Good:

> We know how many shares you own, but the latest verified distribution history is temporarily unavailable. The app is keeping the last verified planning basis and marking it as older data rather than guessing a new yield.

Bad:

> INCOME_EVIDENCE_LANE DEGRADED / BASIS UNKNOWN.

Good:

> OpenBB is connected. The options route works, but the full options research lane has not stored enough usable evidence yet.

Bad:

> V3 OPTIONS GREEN.

## Investment recommendations

A recommendation should explain:

1. what changed,
2. why it matters to this portfolio,
3. what action is worth considering,
4. why doing nothing may still be appropriate,
5. what evidence would change the recommendation.

Do not present a positive price move, high dividend yield, buy-zone flag, AI confidence score, or provider status as a trade instruction by itself.

## Income and self-funding language

Brokerage ownership is the authority for how many shares the user owns. Actual broker-reported cash received is the strongest evidence of what the user personally received when that transaction history is available. FMP and OpenBB provide declared/historical distribution evidence and redundancy.

When a provider briefly misses:

- do not erase a previously verified self-funding calculation,
- retain the most recent verified distribution basis within its allowed freshness window,
- label retained evidence as older/stale,
- never treat retained evidence as a fresh execution price.

The product should explain this simply rather than exposing internal provider mechanics unless the user opens technical details.

## Product-writing check

Before shipping user-facing copy, ask:

> Could a financially curious person understand this sentence without knowing our architecture?

If not, rewrite it in plain English and move the technical detail to a secondary surface.
