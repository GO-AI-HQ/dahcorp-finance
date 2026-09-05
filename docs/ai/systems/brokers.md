# Broker Architecture

Schwab: production OAuth/data, guarded account-specific execution paths and execution-adjacent quote authority. Robinhood: official Agentic Trading MCP via server-side OAuth/PKCE and runtime tool discovery; only broker-designated Agentic account may execute through that lane.

Execution capabilities are deliberately narrower than broker permissions. Every live leg independently passes hard allowlist/account/cash/notional/risk/preview/confirmation/revalidation controls.