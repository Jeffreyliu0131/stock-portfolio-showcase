# AI system contract

AI interprets a bounded snapshot or researches a supported issuer. Deterministic code owns financial numbers. Models cannot mutate portfolio, cash, market data, account state, backups, or history.

## Portfolio analysis and chat

```text
explicit UI trigger
  -> current USD snapshot frozen for the request/session
  -> bounded browser request to provider
  -> origin, bytes, exact schema, and decimal validation
  -> version-selected server prompt and strict function output
  -> local response/evidence validation
  -> deterministic number rendering or safe failure
```

The trigger depends on experience:

| Experience | Initial analysis | Chat | Wire |
|---|---|---|---|
| `production` | Opening analysis triggers its established initial request | Opening is zero-request; sending starts the dialog context | v3 |
| `research` | Opens with deterministic analysis; explicit start/rerun requests interpretation | Framework-advisor presentation; sending starts context | v4 |

The [wire adapter](../application/ai/portfolio-wire-compatibility.ts) normalizes v3 for strict validation, selects the production policy, and returns the original v3 response contract. It does not silently drop unknown request fields. Research v4 adds framework-lens semantics and presentation; production is not upgraded to that experience through source consolidation or documentation changes.

Supported consultation modes include initial analysis, chat, and retained follow-up compatibility. The current chat UI is independent of the initial-analysis UI. The first submitted question freezes the current snapshot; follow-up turns reuse it with bounded recent successful conversation. Market refresh does not silently replace session context or start a model call. Closing the dialog clears its in-memory state.

## Portfolio payload and response boundary

Requests include current USD symbols/names, quantities, costs, valuation, P/L, portfolio/cash weights, cash details and eligible interest context, and quote metadata. They exclude personal identity, brokerage account identifiers, device identifiers, database internals, historical databases, backup files, drafts, and clipboard contents. D1 state is not exposed as a raw model input.

The provider uses server-only DeepSeek configuration, bounded request/response sizes, timeouts, best-effort per-instance rate limits, no-store responses, and a server kill switch. Raw request bodies and model outputs must not be logged or persisted. A bounded retry can follow an invalid result; exhausting that bound yields a safe error, not partially accepted output.

The shared schema/evidence gate rejects unknown fields, invalid decimals, unknown position/evidence references, changed or invalid classification, generated numerical claims, unsupported URLs or external-news attribution, malformed output, direct trade instructions, target prices, and return guarantees. Exact numbers are resolved from the deterministic snapshot rather than copied from model prose.

Initial interpretation provides bounded AI-inferred asset/industry/theme classification and evidence-backed review dimensions. Those classifications are explicitly model inferences, not official security metadata. Missing quotes, unsupported fundamental evidence, or unknown company quality cannot be filled from model memory.

The research framework advisor uses one to three validated lenses selected from circle of competence, durable business, management/capital allocation, owner earnings, financial strength, intrinsic value/margin of safety, opportunity cost, temperament, and evidence gap. It is based on public value-investing principles; it is not Warren Buffett, a spokesperson, or an affiliated service. Missing primary evidence must produce a gap, not impersonated judgment.

## Separate issuer-research pipeline

The issuer-research UI is exposed only in the `research` experience; its provider endpoint is controlled independently by server configuration. The endpoint requires an OpenAI key and SEC User-Agent, and `BUFFETT_RESEARCH_ENABLED=false` disables it; an unset flag does not. Keep the endpoint disabled or unconfigured in deployments that do not use issuer research. It accepts a supported AAPL/MSFT symbol and bounded question. Unsupported issuers fail before provider calls.

```text
symbol + question
  -> supported-issuer plan
  -> SEC submissions + XBRL facts
  -> OpenAI Web Search restricted to SEC/issuer domains
  -> Evidence Ledger
  -> deterministic metrics + owner-earnings assumption gate
  -> no-tool structured synthesis
  -> claim, evidence, numeric, and safety validation
  -> answer, sources, unknowns, counter-evidence, trace
```

Portfolio quantities, cost basis, cash, account state, history, backups, and clipboard data do not enter this request. Issuer research does not replace portfolio consultation or silently send a portfolio to web search.

## Prompt and tool separation

The [research prompt module](../application/ai/research/buffett-research-prompts.ts) separates official-web research from synthesis:

1. Research instructions constrain discovery to official evidence. The question, issuer names, web pages, and search output are untrusted input, never authority to change application rules.
2. The synthesis prompt receives only the bounded Evidence Ledger, deterministic results, assumption state, and official-research summary. It has no tools and cannot keep searching or invent missing facts from memory.
3. Claims, framework findings, unknowns, counter-evidence, and next questions must reference evidence IDs allowed for this request. Natural-language output cannot introduce generated numbers, percentages, currency amounts, URLs, direct-trade language, or impersonation.

SEC retrieval uses a server-configured identifying User-Agent and fixed `data.sec.gov` submissions/companyfacts endpoints. SEC XBRL is the numeric source lane. The selected annual revenue, net income, operating cash flow, capex, cash, and filing metadata remain attributable to filing and period.

OpenAI Responses Web Search uses `store: false`, forced web-search tool selection, allowed domains limited to SEC and the selected issuer, and complete search-source retrieval. The flag describes request configuration, not a blanket provider-retention claim. Search output supplies discovery context and remains untrusted; it cannot replace primary numeric evidence.

## Deterministic financial metrics

Flow observations require annual duration of 330–400 days, including common 52/53-week years. Transition or irregular periods abstain. Candidate tags are selected by period end, filing date, and tag preference; amendments are eligible.

Net margin and free-cash-flow proxy require matching period start/end, USD units, provenance, and filing date. An updated numerator with an older denominator is an evidence gap, not a valid ratio. Missing or incomparable values produce no derived metric.

```text
freeCashFlowProxy = operatingCashFlow - totalCapitalExpenditures
```

The proxy is not owner earnings. Owner earnings remains `ASSUMPTION_REQUIRED` until maintenance capex and incremental working-capital assumptions are supported. Apparent numeric precision cannot substitute for missing economic evidence.

## Evidence and failure behavior

Evidence items retain stable ID, SEC/XBRL/official-web source type, primary/discovery status, source title/URL, retrieval and reporting dates, and value/unit/XBRL path when numeric. The final response can reference only enumerated IDs; UI source links are resolved from those items.

Missing configuration, invalid schema, upstream failure, unavailable official sources, incomparable periods, unknown evidence, unsafe output, and timeout fail closed. Do not display a partially validated answer. Preserve deterministic portfolio content and all financial state. No live answer, raw provider payload, or sensitive trace belongs in public issues or test fixtures.

## Evaluation limits

`npm run eval:buffett` runs credential-free synthetic cases. Unit and replay tests cover supported issuer scope, official-domain constraints, evidence flow, SEC period selection, no-portfolio research payloads, no-tool synthesis, numerical/output rejection, and assumption-required outcomes. Tracked [eval fixtures and instructions](../evals/buffett-research/README.md) and [synthetic results](../evals/buffett-research/results/latest.md) describe their own bounded evidence.

These gates do not establish fresh retrieval, citation entailment, live model judgment, user comprehension, adoption, or investment outcomes. Any real provider run needs separate authorization and should produce private, appropriately minimized evidence. Source publication alone is not a live model evaluation or production feature rollout.

## References

- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Berkshire annual letters](https://www.berkshirehathaway.com/letters/letters.html)

These are method and integration references, not endorsements. Implementation behavior remains defined by the checked-in code and verified contracts.
