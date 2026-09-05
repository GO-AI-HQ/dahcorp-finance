# AI Agent Instructions — DAHCorp Finance

Before any task, read current state, relevant ADR/system docs, recent PR history and `docs/agentic/`.

Never:
- infer live holdings/cash/prices from fixtures;
- convert UNKNOWN into neutral/zero when that changes a decision;
- widen a ticker/account/order-type/size authority from prose;
- treat strategy planning rates as execution quotes;
- treat model consensus as authorization;
- retry an ambiguous broker submission;
- expose brokerage/OAuth/model secrets.

For strategy work, preserve independent OpenAI proposal and Claude challenge where requested, pass both the same explicit provenance envelope, reconcile in Strategy Lab, then run deterministic risk/authorization. Grok remains bounded by its role contract.

Repository changes use branches/PRs. Every PR gets Institutional Memory Impact and matching `PR-NNN.md`; update affected ADR/system/agentic docs in the same change.