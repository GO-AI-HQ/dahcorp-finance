# ADR-001 — Deterministic Risk Authority

**Status:** Accepted

LLM recommendations cannot bypass deterministic risk/policy. Any block finding can zero/deny an order independently of model preference. Live execution requires broker/account/ticker/order-type/size/cash/quote/approval checks defined by code/policy.