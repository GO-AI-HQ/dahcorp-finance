# DAHCorp Finance Product Language Standard

## Default rule

DAHCorp Finance should sound like a capable person explaining money to another person.

Primary screens, buttons, cards, alerts and recommendation summaries must use ordinary human language first. Do not make the user translate AI terminology, quant terminology, brokerage jargon or internal architecture names before they can understand what their money is doing.

## Preferred wording

Use the clearest everyday phrase that preserves the financial meaning.

| Prefer | Avoid on primary UI |
| --- | --- |
| Strategist | Agent / agentic engine |
| Market | Intelligence fabric |
| Market information | Evidence fusion |
| Safety rules | Deterministic policy / deterministic risk engine |
| Cash available | Deployable capital |
| Savings floor / protected savings | External liquidity target |
| Savings balance | External liquidity current |
| Keep cash available | Hold cash queue / preserve liquidity |
| What the app can see | Provider fabric / data plane |
| What happened after similar events | Historical relevance |
| What it means for you | Strategic translation |
| Check before buying | Execution eligibility validation |
| Final preview | Guarded execution preview |
| Current plan | Baseline allocation |
| Compare choices | Scenario optimization |
| Research coverage | Evidence-lane fusion coverage |

These are examples, not a word-replacement engine. Write the sentence that a financially literate person would naturally say.

## Where technical language is appropriate

Technical terms are allowed when they add necessary precision, especially in:

- expandable technical details;
- audit logs;
- developer/admin screens;
- source/provenance labels;
- settings that control a genuinely technical financial rule;
- legal/compliance explanations;
- exact broker or API error diagnostics.

When a technical term is necessary on a primary screen, explain it immediately in ordinary language.

## AI language

Do not make the product feel like an AI demonstration. The user should experience useful financial reasoning, not constant reminders that models are involved.

- OpenAI/Terra is presented as the **Strategist** where a role label is needed.
- Claude is presented as the **Research Analyst** or **independent research pass** where relevant.
- The safety layer is described as **safety rules** in primary UI.
- Model/provider names belong in details, provenance, audit history or an optional status badge—not in every sentence.

## Financial language

Do not oversimplify away real distinctions. Plain language still has to be financially accurate.

Examples:

- A Treasury yield is not described as a bank savings APY.
- The highest advertised savings APY is not described as personally available until balance tiers, geography, membership and eligibility are checked.
- A projected distribution is not described as income already received.
- A market signal is not described as a prediction.
- Cash above a household savings floor is not automatically called investable.

## Recommendation style

A useful recommendation should answer, in this order:

1. What should I do—or not do?
2. Why does that make sense for my actual situation?
3. How much money, if any, should move?
4. What could make the recommendation wrong?
5. What information is missing or stale?
6. What happens next if I choose to act?

Use short headings and normal sentences. Avoid ceremonial phrases such as “capital deployment framework,” “agentic orchestration,” “deterministic enforcement,” or “alpha-generating opportunity” when a simpler phrase communicates the same thing.

## Data-state language

Connection health and usable research are different facts. The product must say which one it means.

- **Route working** means the app successfully reached that API/data route.
- **Research lane populated** means the full research process stored usable evidence for that lane.
- A provider may be connected while only one of several research lanes is populated.

Do not label a successful route probe as though the entire research lane is live.

When a market or income feed briefly misses:

- do not remove a configured card from the page;
- do not turn a previously verified planning calculation into `$0`;
- keep the most recent verified planning evidence within its allowed freshness window;
- label retained evidence as older/stale;
- never use retained planning evidence as fresh execution pricing.

For held income positions, the product should explain the evidence hierarchy plainly: the broker is authoritative for shares owned and actual cash received when transaction history is available; FMP supplies preferred declared distribution history; OpenBB is the fallback/redundant distribution source; DAHCorp performs the self-funding math.

## Review requirement

Any new user-facing feature should be reviewed against this standard before merge. If a sentence sounds like it belongs in an architecture document, trading desk memo or AI research paper, rewrite it for the product UI and move the technical version into details if it still has value.
