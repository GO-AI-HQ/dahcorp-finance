# FMP distribution evidence

DAHCorp Finance uses Financial Modeling Prep as the preferred cash-distribution history source when `FMP_API_KEY` is configured.

## Roles

- **Schwab**: current execution-adjacent quotes.
- **FMP Dividends Company**: preferred historical distribution amounts and payment dates.
- **OpenBB/yfinance**: fallback distribution history plus market price history.
- **DAHCorp calculations**: trailing and modeled distribution rates, self-funding share counts, income projections and total-return comparisons.

## Call-budget policy

FMP is not polled like a quote feed. Distribution snapshots are cached for 12 hours and the income universe is warmed twice per day. With the current 10-symbol income universe, scheduled use is about 20 calls/day, leaving substantial room inside a 250-call/day personal plan for occasional newly held symbols and diagnostics.

## Guardrails

- Provider-reported `yield` is not treated as an annualized return for weekly/monthly option-income funds.
- Future declared distributions are retained in source evidence but excluded from trailing-income math until the ex-date occurs.
- FMP is preferred when it returns usable history; OpenBB fills symbols that FMP cannot cover.
- Return-of-capital and tax character remain UNKNOWN unless supported by issuer tax or Section 19a evidence.
- No dividend amount, yield, payment date or tax character is fabricated when providers are unavailable.
