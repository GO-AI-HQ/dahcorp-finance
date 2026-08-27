# DAHCorp Finance

A private, agentic capital-management dashboard for one investor.

It aggregates Robinhood and Schwab holdings, measures distribution income
honestly, models the compounding of that income, tracks progress toward monthly
income targets, manages a tactical semiconductor strategy, and lets Claude
recommend where the next dollar goes — behind a deterministic risk engine that
Claude cannot bypass.

> **Phase 1 (Observer).** Read, analyse, preview. Live trading is disabled and
> cannot be enabled by configuration alone. Ships with clearly labelled mock
> data. Not investment advice.

---

## The thesis

Build a high-cash-flow portfolio until its own distributions purchase assets
without new deposits, then progressively redirect that cash flow into long-term
growth — a self-funding capital flywheel.

The measure of success is not account value. It is how much the portfolio buys
per month without external money. See
[`docs/INVESTMENT_STRATEGY.md`](docs/INVESTMENT_STRATEGY.md).

---

## Quick start

```bash
npm install
cp .env.example .env          # set DAHCORP_ACCESS_PASSCODE at minimum
npm run dev                   # Vite dev server
# or, to run the functions too:
netlify dev
```

```bash
npm test          # 272 tests over the financial and policy core
npm run build     # tsc -b && vite build
```

With no database and no broker credentials the app runs end-to-end on the seeded
model, labelled as mock in every payload and every card.

---

## Architecture

```
Claude → Recommendation → Deterministic Policy / Risk Engine → Trade Preview → Human Approval → Broker Execution
```

Claude sits at the left of that chain and nowhere else. It emits advisory data;
`src/risk/engine.ts` decides independently from the portfolio, the quotes and the
stored config. A `block` finding zeroes an order regardless of what was
requested — there is no override parameter and no second code path.

```
src/
  core/          pure, tested financial calculations — the single source of truth
  risk/          deterministic policy & risk engine
  strategy/      deterministic baseline allocation
  agent/         Claude prompt, output schema, digest, deterministic fallback
  brokers/       adapter interface + robinhood/ and schwab/ implementations
  market/        market-data provider interface + mock provider
  services/      snapshot assembly, analysis payloads, browser API client
  hooks/         session and resource hooks
  components/    UI primitives (cards, badges, states, shell)
  charts/        Recharts wrappers
  pages/         the nine views
  styles/        design tokens and layout
  data/          seed model and fixtures
netlify/
  functions/     the HTTP API
  lib/           session, http, store, claude, per-request context
db/              Drizzle schema (Netlify Database)
docs/            strategy, policy, broker, security, roadmap
tests/           vitest suites for every calculation module
```

Everything in `src/core/` is pure and side-effect-free, and is shared
byte-for-byte between the browser, the functions and the tests. **No financial
arithmetic happens in a component.**

### API

| Endpoint | Purpose |
|---|---|
| `GET /.netlify/functions/portfolio` | Accounts, holdings, sleeves, exposure, concentration |
| `GET /.netlify/functions/income` | Distribution analysis, forward income, milestones, self-buy |
| `GET /.netlify/functions/signals` | Trend, dip, harvest and risk signals |
| `POST /.netlify/functions/analyze` | Claude recommendation + risk validation |
| `POST /.netlify/functions/order-preview` | Deterministic validation of proposed orders |
| `POST /.netlify/functions/order-execute` | **Disabled.** Returns 403, audits the attempt |
| `POST /.netlify/functions/simulate` | Goal simulator scenarios |
| `GET/PUT /.netlify/functions/settings` | Strategy configuration |
| `GET/POST /.netlify/functions/activity` | Audit log, recommendation history, decisions |
| `auth-login` / `auth-logout` / `auth-session` | Session management |

### Views

Overview · Income Engine · Portfolio · Semiconductor · Opportunities ·
Simulator · Claude · Activity · Settings

---

## What it measures

- **Income, honestly.** Distribution income, dividends, return of capital,
  realized and unrealized gains, NAV change and total return are separate
  numbers. A distribution is never reported as pure profit because cash arrived.
- **Cash-Flow Efficiency Score.** Cash per invested dollar over 4/13/26/52
  weeks, plus stability, trend, NAV preservation, total return, ROC share,
  drawdown, liquidity, volatility, correlation and concentration. Never ranked
  by advertised yield.
- **Self-Buy Ratio.** Shares the portfolio buys with its own distributions per
  week, month and year, and the shares required for a position to buy one more
  of itself.
- **Milestones.** $150 → $500 → $1,000 → $2,500 → $5,000 per month, with
  required capital *derived* from the modeled rate, never a fixed dollar figure.
- **Semiconductor engine.** TSM + SMH permanent cores; TSMX and SOXL tactical
  sleeve with a configurable cap, harvest rules and explicit volatility-drag
  modeling — 3× *daily* leverage is not 3× long-term return.
- **Deterministic signals.** 20/50/200-day MAs, RSI, drawdown, volume and
  relative strength produce TREND CONFIRMED / WEAKENING / LOST in code. Claude
  interprets them; it does not decide them.

Every default — the $10,000 liquidity reserve, the 50/50 income split, the 10%
leverage cap, the harvest triggers, the dip levels — is configurable in Settings.
Nothing is permanently hard-coded, and no observed price or distribution is
treated as a permanent fact.

---

## Security

The whole dashboard sits behind a passcode; **with no passcode configured the API
is locked, not open.** Sessions are HMAC-signed, HttpOnly, Secure,
SameSite=Strict cookies containing nothing but an issue time and an expiry. No
token of any kind is held by JavaScript or written to `localStorage`. All
credentials are read server-side only, never prefixed `VITE_`, and never
returned in a response.

Full detail, including the deployment checklist, in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Configuration

See [`.env.example`](.env.example). The only variable required for a working
deploy is `DAHCORP_ACCESS_PASSCODE`; `DAHCORP_SESSION_SECRET` is strongly
recommended. Broker variables should stay unset in Phase 1.

Optional: `netlify db init` to provision Netlify Database (persists settings, the
audit log and recommendation history), and the Netlify AI Gateway to enable
Claude-authored analysis without storing an Anthropic key anywhere.

---

## Deploying

This project is not inside any other repository and has no remote configured.
**Connect it to a new private GitHub repository named `dahcorp-finance`:**

```bash
gh repo create dahcorp-finance --private --source=. --remote=origin --push
# or, without the gh CLI: create the private repo in the GitHub UI, then
git remote add origin git@github.com:<you>/dahcorp-finance.git
git push -u origin main
```

Then, in Netlify: **Add new site → Import an existing project**, select the
`dahcorp-finance` repository, and set the environment variables from
`.env.example`. Build settings come from `netlify.toml` (`npm run build`, publish
`dist`, functions `netlify/functions`).

Keep the repository **private**. This dashboard renders a real financial
position and is served `noindex, nofollow, noarchive` with a strict CSP.

---

## Documentation

| | |
|---|---|
| [`docs/INVESTMENT_STRATEGY.md`](docs/INVESTMENT_STRATEGY.md) | The strategy, and where each rule lives in code |
| [`docs/CLAUDE_POLICY.md`](docs/CLAUDE_POLICY.md) | What the model may and may not do, and how that is enforced |
| [`docs/BROKER_ARCHITECTURE.md`](docs/BROKER_ARCHITECTURE.md) | Adapter design, Robinhood and Schwab, order lifecycle |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Secrets, auth, headers, audit, deployment checklist |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Eight phases, with exit criteria |

---

## Tests

```
tests/math.test.ts               29    tests/portfolio.test.ts        16
tests/dates.test.ts              12    tests/income.test.ts           27
tests/distributions.test.ts      25    tests/projection.test.ts       28
tests/cashflowEfficiency.test.ts 13    tests/signals.test.ts          20
tests/selfBuy.test.ts            13    tests/semiconductor.test.ts    26
tests/corporateActions.test.ts   16    tests/risk.test.ts             32
tests/config.test.ts             15
```

Fixtures are hand-built so every expected figure can be checked by hand. The
suites encode the rules, not just the arithmetic: reserved capital is never
investable, a raw historical share count is never the goal, a decline is not
undervaluation, received cash is not profit, and execution is disabled in every
phase.

---

Private project. Not a product, not investment advice.
