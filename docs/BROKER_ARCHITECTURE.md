# Broker Architecture

How brokerages connect to this application, and why the seams are where they
are.

---

## 1. The required shape

```
Claude → Portfolio Service → Risk Engine → Broker Adapter → Brokerage API
```

and never:

```
Claude → raw broker credentials
```

Claude has no reference to any adapter. Adapters are constructed server-side
only, once per request, by `buildBrokerRegistry()` from environment variables
(`src/brokers/registry.ts`). Nothing in `src/brokers/**` is imported by browser
code, and no credential ever appears in a response body.

Every broker implements one interface — `BrokerAdapter` in
`src/brokers/types.ts`:

```ts
readonly id: BrokerId;
readonly label: string;
readonly capabilities: BrokerCapability[];
isConfigured(): boolean;
configurationStatus(): { configured: boolean; missing: string[]; note: string };
authenticate(): Promise<{ ok: boolean; message: string }>;
getAccountData(): Promise<BrokerAccountData>;
previewOrder(order: ProposedOrder): Promise<OrderPreviewResult>;
placeOrder(order, previewToken): Promise<OrderStatus>;   // must throw in Phase 1
getOrderStatus(brokerOrderId): Promise<OrderStatus>;
```

Adapters translate payloads and nothing else. They contain no strategy logic, no
risk logic and no fixture data — the seeded portfolio model is supplied to them
by the portfolio service as a `fallback` function, so the same adapter code runs
against mock and live data.

### Capability gating

`capabilities` is an allow-list, and it is honest about what exists.
`place_order` is **absent** from every adapter in this build rather than present
and disabled, so nothing downstream can discover a path to it. `placeOrder()`
throws `ExecutionDisabledError` unconditionally.

---

## 2. Robinhood

Robinhood does not publish a general-purpose retail trading API. This adapter is
therefore written as a thin, capability-gated shell designed against
Robinhood's **official agentic/MCP surface**, to be filled in when that surface
is available to this account.

**No unofficial private API is used. No username or password is ever accepted or
stored.** There is no scraper and no reverse-engineered client, and adding one is
out of scope for this project.

| Mode | Behaviour |
|---|---|
| `mock` *(default)* | Reads the seeded portfolio model. Read-only. |
| `manual` | Positions maintained by the investor in the app database. Read-only. |
| `live` | Refuses to run: reports that the official integration is not implemented in this build. |

Configuration (server-side only, never in client code):
`ROBINHOOD_MODE`, `ROBINHOOD_MCP_ENDPOINT`, `ROBINHOOD_ACCESS_TOKEN`.

Phase 1 target: **read-only** — accounts, positions, share counts and cost
basis, so the income engine can see the NVDY accumulation.

---

## 3. Charles Schwab

A thin, modular wrapper around the **official Schwab Trader API**
(`https://api.schwabapi.com`). It translates between Schwab's payloads and this
application's domain types, narrowed to only the fields consumed, so a change on
either side is a single-file change.

| Mode | Behaviour |
|---|---|
| `mock` *(default)* | Reads the seeded portfolio model. |
| `live` | Requires `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET` and `SCHWAB_REFRESH_TOKEN`; reports exactly which are missing rather than failing opaquely. |

OAuth rules, enforced by where the code lives:

- Client secret and refresh token are read in function runtime only.
- Access tokens are short-lived and held in function memory, never persisted and
  never returned to the browser.
- When live integration is added, refresh tokens go into **encrypted
  server-side storage** — not a plaintext environment variable, not
  `localStorage`, not a cookie readable by JavaScript.
- The OAuth callback is a server-side route. The authorization code is never
  handled by client JavaScript.

Read scope first (accounts, positions, transactions, quotes). Trading scope is
requested only when Phase 4 is actually being enabled.

---

## 4. Market data

`MarketDataProvider` (`src/market/provider.ts`) is a separate seam from the
brokers: quotes, price history and distribution history can come from a market
vendor even while positions come from a broker.

Only `mockMarketDataProvider` exists in this build. Any other value of
`MARKET_DATA_PROVIDER` logs a warning and falls back to mock — the app never
quietly misrepresents where a number came from. Every quote, bar and payment
carries a `dataQuality` flag of `mock`, `delayed` or `live`, which propagates
into the API payloads, the UI banners and the risk findings
(`MOCK_QUOTE`, `STALE_QUOTE`).

---

## 5. Order lifecycle

```
1. Recommendation (Claude) or manual entry
2. validateOrders() / validateAllocation()   ← deterministic risk engine
3. Trade preview shown to the investor, with every finding and every reduction
4. Human APPROVE / REJECT / EDIT             ← Phase 4, not this build
5. adapter.previewOrder()                    ← broker-side validation
6. adapter.placeOrder()                      ← Phase 5, throws today
7. adapter.getOrderStatus() → audit log
```

Steps 1–3 are fully implemented. Steps 4–6 exist as typed interfaces with no
live implementation, so the shape of the integration is fixed and reviewable
now.

Duplicate protection is deterministic: `orderKey()` fingerprints an order as
`accountId|SYMBOL|side|notional|quantity`, checked against both recently
submitted orders and the rest of the current batch.

---

## 6. Adding a broker

1. Implement `BrokerAdapter` in `src/brokers/<name>/adapter.ts`.
2. Read configuration from `env` in a `read<Name>Config()` function. Do not read
   `process.env` anywhere else.
3. List only the capabilities that actually work.
4. Register it in `buildBrokerRegistry()`.
5. Return `missing` from `configurationStatus()` so the Settings view can tell
   the investor precisely what is unset.

No change to `src/core/**`, `src/risk/**` or any component should be required.
If one is, the seam is in the wrong place.

---

## 7. What execution would require

Enabling live trading is not a matter of flipping a flag. It requires, in order:

1. Phase 4 approval mode in the UI.
2. The execution phase added to `EXECUTION_ENABLED_PHASES` in
   `src/risk/engine.ts` (currently an empty array).
3. Per-account `tradeEligible` enabled.
4. Encrypted server-side storage for broker OAuth refresh tokens.
5. A broker adapter that advertises the `place_order` capability.

None of those exist in this build, and `order-execute` returns `403
EXECUTION_DISABLED` while recording the attempt to the audit log.
