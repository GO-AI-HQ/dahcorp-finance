# ADR-008 — Snapshot-First Durable Data Plane

**Status:** Proposed / in progress (PR #33/#34 not merged into baseline)

Interactive Portfolio, Income, Strategy and model preparation should consume prepared durable snapshots first; scheduled jobs own provider fan-out; cold-start live paths remain explicit fallback. Last-known-good freshness is evidence-family-specific and expired data becomes unusable.

Do not mark Accepted until the relevant hardening PR is merged.