# Current State — DAHCorp Finance

## Merged baseline: through PR #32
- Schwab production OAuth/data and a guarded YMAG BUY lane were introduced early, with explicit preview, typed confirmation, fresh cash/quote revalidation, second broker preview and ambiguous-submission reconciliation.
- Robinhood official Agentic Trading MCP is directly integrated server-side; only broker-designated Agentic accounts may execute, with OAuth/PKCE and encrypted token persistence.
- Shadow/Confirm/Bounded execution-mode policy exists with Shadow as the safe foundation; deployment and deterministic risk gates remain authoritative.
- Market Intelligence evolved from Finnhub/Federal Register/OpenBB foundations into production Intelligence Fabric v2/v3 with explicit lane/freshness/provenance semantics and UNKNOWN rather than fabricated data.
- Schwab remains preferred for execution-adjacent quotes; OpenBB supplies broad market/macro/history evidence; Finnhub supplies company/reference/earnings evidence; FMP became the preferred income distribution source with a hard DAHCorp daily request budget and OpenBB fallback.
- RateAPI/short-duration Treasury references support household-liquidity comparison with clear product semantics.
- Strategy Lab and Modeling Lab are planning/recommendation surfaces; live execution remains separately gated.
- PR #31 introduced retained evidence/state stability; PR #32 moved retained-distribution persistence out of interactive Portfolio requests after a production 502, preserving last-good reads while scheduled work owns persistence.

## Open/unmerged work
- PR #12: bespoke transaction semantic-fallback safety correction.
- PR #33: provider/data-plane hardening audit contract.
- PR #34: snapshot-first durable data-plane implementation; draft reports 337 tests and controlled 97% usable-state under injected failures, but is explicitly not yet a measured production SLA and is not merged into this branch baseline.

## Safety ceiling
Model output cannot expand account mandates, allowlists, cash floors, risk ceilings or execution permissions. Every order path must revalidate execution-authoritative broker/market state immediately before submission.