# ADR-007 — Ambiguous Broker Submissions Are Never Automatically Retried

**Status:** Accepted

If transport fails after placement may have reached a broker, mark the action `submission_unknown`, consume/lock the preview and reconcile against broker order history before any further attempt.