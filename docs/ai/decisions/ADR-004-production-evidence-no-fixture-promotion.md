# ADR-004 — Production Evidence Never Falls Back to Fixtures

**Status:** Accepted

Provider failures become UNKNOWN/empty or policy-defined retained last-known-good evidence. Production must never silently substitute seeded/mock market or broker data.