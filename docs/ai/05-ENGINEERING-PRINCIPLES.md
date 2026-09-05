# Engineering Principles — DAHCorp Finance

1. Pure financial arithmetic belongs in tested core modules, not UI components or model prompts.
2. Models advise; deterministic risk and policy authorize.
3. Broker visibility is not spending authority.
4. Deposit/cash availability does not imply purchase; Cash Queue may wait.
5. Shadow evidence is evidence, not a probability and not authority.
6. Missing production evidence is UNKNOWN; never fabricate a substitute.
7. Last-known-good evidence has explicit freshness windows and cannot become execution pricing.
8. Planning evidence and execution evidence are separate; orders revalidate fresh state.
9. Account mandates and allowlists can be narrowed by settings, never widened beyond hard code/policy ceilings without reviewed architecture change.
10. Ambiguous broker submission is `submission_unknown`, never automatic retry.
11. External household reserve is distinct from deployable broker cash and may not be silently invested.
12. Every material PR updates institutional memory and agentic contracts.