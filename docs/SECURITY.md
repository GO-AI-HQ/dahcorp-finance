# Security

This application holds one person's complete financial position. It is designed
as a private system, not a public dashboard with a login bolted on.

---

## 1. Non-negotiable rules

**No secret is ever exposed to the browser.** None of the following may appear in
frontend JavaScript, in a bundle, in a response body, or in a log:

- Schwab client secret
- Brokerage access or refresh tokens
- Anthropic API key
- Any private API credential
- The session signing secret
- The access passcode

Enforcement is structural rather than procedural:

- All server configuration is read inside Netlify Functions. Nothing is
  prefixed `VITE_`, so nothing can be inlined into the client bundle by Vite.
  *Never put a secret in a `VITE_`-prefixed variable — that publishes it.*
- `.env` is gitignored; `.env.example` contains names and comments only.
- **No broker token is stored in `localStorage`, `sessionStorage` or any
  JavaScript-readable cookie.** The browser holds no token at all.
- Broker adapters are constructed server-side only and their status objects are
  filtered to `configured` / `missing` / `note` — names of missing variables,
  never values.
- When live brokerage integration is added, OAuth refresh tokens go into
  **encrypted server-side storage**, not a plaintext environment variable.

---

## 2. Authentication

The **entire application** sits behind a passcode. Every data function calls
`requireSession()` before touching data; there is no unauthenticated read path.

- `DAHCORP_ACCESS_PASSCODE` gates access. **With no passcode configured the API
  is LOCKED, not open** — functions return 401 and the UI shows a setup notice.
  Failing closed is deliberate.
- Login issues an **HMAC-SHA-256 signed, HttpOnly, Secure, SameSite=Strict**
  cookie containing only an issue time and an expiry. No portfolio data, no
  token, nothing readable by JavaScript.
- Passcode comparison is constant-time over digests, so a mismatch leaks no
  timing information.
- Login attempts are throttled (8 per 5 minutes per client) and every failure is
  audited. The passcode is never echoed and never logged.
- `DAHCORP_SESSION_SECRET` signs the cookie. If unset, a key is derived from the
  passcode — workable, but rotating the passcode then invalidates all sessions.
  Set it explicitly.

### Session timeout and logout

`DAHCORP_SESSION_TTL_MINUTES` (default 60, max 1440) bounds session life. The UI
counts down, warns before expiry, and returns to the sign-in screen when the
session lapses. Logout clears the cookie server-side with `Max-Age=0`.

### The public-demo escape hatch

`DAHCORP_ALLOW_PUBLIC_DEMO=true` serves the labelled mock dataset with no
passcode, for demonstrating the interface. It **refuses to activate if any live
credential is present** (`SCHWAB_*`, `ROBINHOOD_ACCESS_TOKEN`,
`ANTHROPIC_API_KEY`), so it cannot accidentally expose a live-connected
deployment. Leave it `false` for real use.

---

## 3. Transport and browser hardening

Set in `netlify.toml` and `netlify/lib/http.mts`:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; no third-party origins; `frame-ancestors 'none'`; `object-src 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Robots-Tag` | `noindex, nofollow, noarchive` |
| `Cache-Control` (all API responses) | `no-store, no-cache, must-revalidate, private` |
| `Vary` | `Cookie` |

Nothing is loaded from a third party: no webfonts, no analytics, no CDN, no
tracking. `'unsafe-inline'` is permitted for **style only**, because React
`style` props and chart rendering emit inline style attributes; scripts remain
`'self'` with no inline allowance.

Requests are same-origin with `credentials: 'same-origin'` (`src/services/api.ts`).

---

## 4. Error handling

`withErrorHandling()` wraps every function. An unexpected throw is logged
server-side with the function name and returns:

```json
{ "error": { "code": "INTERNAL_ERROR", "message": "The request could not be completed. The error has been logged." } }
```

Stack traces, SQL, provider payloads and internal messages never reach the
browser. Client-side, `ApiError` carries a code so the UI can distinguish an
expired session from a genuine failure and re-authenticate rather than showing a
generic error.

---

## 5. Audit log

Recorded to the database (`recordAudit`), and to the function log when no
database is attached:

- Authentication: success, failure, throttling, logout.
- Every recommendation: timestamp, question, portfolio and market snapshot,
  brief, confidence, source and model, token usage, **the deterministic rule
  outcome**, the user's action and note, and the eventual result.
- Every order preview: symbol, side, account, requested size, origin, whether
  risk approved it, the allowed size and the findings.
- Every attempt on the disabled execution endpoint.
- Settings changes, including rejected fields.

The log holds no credential material. Notes and questions are stored as written,
so treat the database as containing private financial information.

---

## 6. Execution safety

- `EXECUTION_ENABLED_PHASES` in `src/risk/engine.ts` is an **empty array**.
  `executionEnabled` is therefore `false` for every configured phase, including
  5. Asserted in `tests/risk.test.ts`.
- `order-execute` returns `403 EXECUTION_DISABLED` and audits the attempt. It
  imports no broker client and constructs no order — there is no code path from
  that file to a brokerage API.
- `placeOrder()` throws `ExecutionDisabledError` in every adapter, and
  `place_order` is absent from every capability list.
- A global `killSwitch` in the strategy config blocks all previews and orders.
- Claude has no write tool and no override path. A `block` finding zeroes an
  order regardless of what was requested. See `docs/CLAUDE_POLICY.md`.

---

## 7. Environment separation

| | Development | Production |
|---|---|---|
| Data | Seeded mock model, labelled in every payload and banner | Live sources when configured |
| Brokers | `mock` mode, read-only | Explicit `live` mode + credentials |
| Market data | `mockMarketDataProvider` | Configured provider |
| Passcode | Required (or explicit public demo) | Required |
| Execution | Disabled | Disabled in this build |

Every quote, holding and payment carries a `dataQuality` flag of `mock`,
`delayed` or `live`, and `containsMockData` follows the data all the way to the
UI banner and into the risk findings (`MOCK_QUOTE`). **Mock data is never
presented as real**, and the model is told when it is reasoning about it.

---

## 8. Deployment checklist

1. Set `DAHCORP_ACCESS_PASSCODE` to a long random value.
2. Set `DAHCORP_SESSION_SECRET` (`openssl rand -base64 48`).
3. Confirm `DAHCORP_ALLOW_PUBLIC_DEMO` is unset or `false`.
4. Confirm no `VITE_`-prefixed variable holds anything sensitive.
5. Leave `SCHWAB_*` and `ROBINHOOD_*` unset for Phase 1.
6. Enable the Netlify AI Gateway rather than setting `ANTHROPIC_API_KEY`.
7. Run `npm test` — the financial and risk suites must pass.
8. Verify the deployed site returns 401 before sign-in.
9. Confirm the repository is **private**.

## 9. Reporting

This is a single-investor system with no external users. If a weakness is found,
fix it before the next deploy and record it in the audit log.
