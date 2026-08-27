# Claude Policy

What the model is allowed to do in this system, what it is structurally
prevented from doing, and how that boundary is enforced in code.

---

## 1. The boundary

```
Claude → Recommendation → Deterministic Policy / Risk Engine → Trade Preview → Human Approval → Broker Execution
```

Claude sits at the **left** of that chain and nowhere else. It produces a
`RecommendationBrief` (`src/agent/types.ts`) — advisory data. Every leg it
proposes is then validated independently by `src/risk/engine.ts`, which reads
only the portfolio snapshot, the quotes and the stored `StrategyConfig`.

**Claude may never bypass the risk engine.** This is not a promise about
prompting; it is a property of the call graph:

- The model's output is parsed into a typed brief and validated
  (`src/agent/schema.ts`). Malformed output is rejected, not repaired.
- The only route from a brief to anything actionable is `validateAllocation()`,
  which wraps each leg as a `buy` order with `origin: 'claude'` and runs the
  identical checks a manually-entered order gets. There is no second code path.
- `order-execute` contains no broker client, no credential read and no order
  construction. There is deliberately no code path from that file to a brokerage
  API.
- A `block` finding sets `allowedNotional` to `0` regardless of what was
  requested or how confidently it was argued. There is no override parameter,
  and no field in the model's output schema can influence a finding.

Claude has no tool that writes. It cannot change settings, dismiss a finding,
raise a limit, mark an account eligible, or advance the execution phase. It can
*propose* a settings change in prose; a human then types it into Settings.

---

## 2. Claude's role

**Portfolio strategist and supervisory intelligence layer.**

- Interpret the deterministic signals it is given and explain what they mean for
  the plan.
- Recommend where the next dollar goes, with reasoning.
- Compare its own recommendation against the deterministic baseline plan
  (`src/strategy/allocation.ts`), and be specific about where and why it differs.
- Always offer one genuinely different alternative allocation, so the investor
  sees a real choice rather than a rubber stamp.
- Surface risk the investor has not asked about.

### Standing questions

The model is expected to be able to answer these at any time
(`STANDING_QUESTIONS` in `src/agent/prompt.ts`):

1. Where should my next dollar go?
2. What is my highest cash-flow-efficiency investment right now?
3. Which position is dragging the portfolio?
4. Am I over-concentrated?
5. Am I over-leveraged?
6. What gets me to $500/month fastest without unacceptable risk?
7. Should I harvest tactical gains now?
8. Is my income durable or eroding NAV?
9. What changes if I add $250/month?

---

## 3. Hard rules given to the model

Stated in the system prompt, and independently enforced downstream:

| # | Rule | Enforced by |
|---|---|---|
| 1 | Never treat a distribution as pure profit because cash arrived | `distributions.ts` reports ROC-net economic income separately; `null` when ROC is unreported |
| 2 | Never rank by advertised yield alone | `cashflowEfficiency.ts` composite score |
| 3 | Never recommend reserved capital | `investableCash` excludes the reserve; `NO_INVESTABLE_CASH` blocks |
| 4 | Never allocate to an ineligible account | `ACCOUNT_NOT_ALLOCATION_ELIGIBLE` blocks |
| 5 | Never push the leveraged sleeve past its cap | `LEVERAGE_LIMIT_REDUCED` / `LEVERAGE_LIMIT_BLOCK` |
| 6 | Never treat daily leverage as long-term leverage | `estimateVolatilityDrag` is supplied in the digest |
| 7 | Never decide a position has "lost trend" | Trend status is computed in `signals.ts` and passed in as a fact |
| 8 | Never equate "price declined" with "undervalued" | Dip actionability requires trend and momentum to hold |
| 9 | Never invent a price, distribution, yield, share count or date | The digest is the only data given; missing values must be reported as missing |
| 10 | Never label a projection as guaranteed | Scenario labels are fixed by the UI, not the model |
| 11 | Never propose new money for the tactical sleeve as a residual | Requires an explicit entry signal and sleeve headroom |

Rules the model breaks anyway are caught by the engine. The prompt exists so
the recommendations are *usable*, not so they are *safe* — safety is the
engine's job.

---

## 4. What the model sees

`src/agent/digest.ts` builds a compact digest: positions with cost basis and
weights, per-symbol distribution history and modeled rates, ROC shares, the
cash-flow efficiency ranking, trend and dip signals with each individual check,
harvest state, sleeve exposure and headroom, milestone progress, the strategy
config, and available capital already net of the reserve.

It does **not** see: any credential, any cookie, the session secret, database
connection details, or anything about the investor beyond the portfolio itself.
Prices and distributions in the digest are labelled with their `dataQuality`, so
the model is told when it is reasoning about mock data and is instructed to say
so in its answer.

---

## 5. Failure behaviour

If no model credentials are present, or the API call fails, or the returned
brief fails schema validation, `/analyze` returns the **deterministic brief**
(`src/agent/fallback.ts`) with `source: 'deterministic'` and a `fallbackReason`.

The dashboard degrades to "no model available" — never to "no answer", and never
to a silently unvalidated answer. The UI always shows which of the two produced
what is on screen, along with the model name and token usage.

---

## 6. Model selection

Allow-listed via `CLAUDE_MODEL`: `claude-opus-5`, `claude-sonnet-5`,
`claude-haiku-4-5`, `claude-opus-4-8`. Anything else logs a warning and falls
back to `claude-sonnet-5`. The call is made through the Netlify AI Gateway, so no
Anthropic key needs to exist in this repository or in the browser.

---

## 7. Audit

Every recommendation is recorded with: timestamp, question asked, portfolio
snapshot reference, market snapshot reference, the brief itself, confidence,
source (`claude` or `deterministic`), model, token usage, **the deterministic
rule outcome**, the user's action (`approved` / `rejected` / `edited`) with an
optional note, and the eventual result.

The deterministic outcome is stored next to the recommendation deliberately: the
record shows not only what the model advised but what the engine permitted. See
`docs/SECURITY.md` for retention and the Activity view for the log itself.

---

## 8. Phase discipline

| Phase | Claude's capability |
|---|---|
| 1 — Observer *(this build)* | Read, analyse, explain. Recommendations only. |
| 2 — Analyst | Ranked opportunities and proposed reallocations. |
| 3 — Paper Trader | Simulated fills, tracked against outcomes. |
| 4 — Approval Mode | Human APPROVE / REJECT / EDIT on each order. |
| 5 — Limited Autonomy | Bounded, pre-authorised actions inside hard limits. |

Automatic live trading is not enabled in this build and cannot be enabled by
configuration alone. `EXECUTION_ENABLED_PHASES` in `src/risk/engine.ts` is an
empty array, so `executionEnabled` is `false` even if `executionPhase` is set to
5 — verified in `tests/risk.test.ts`.
