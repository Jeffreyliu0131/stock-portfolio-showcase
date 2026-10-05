# Security

This independent showcase has no connected production deployment. Its default workflow is local review with synthetic data. The provider/Sites source and release tooling are included for study and separately configured installations; their presence is not a claim of safe public paid-API access.

## Public source boundary

Public source contains general code, technical contracts, placeholders, and synthetic test data. Do not publish:

- Holdings, balances, brokerage exports, portfolio backups, copied portfolio text, or screenshots of real assets.
- Private financial context, conversations, account subscription details, operational diaries, or identifying machine paths.
- Credentials, raw authentication headers, personal contact addresses, deployment identifiers, database bindings, browser storage, HAR captures, or sensitive logs.

Git author/committer metadata, commit messages, branches, pull-request refs, discussions, releases, and generated artifacts also form part of the publication boundary. Use an appropriate repository-local privacy identity for commits. A public repository name or a synthetic instrument name is not permission to disclose its operator's private circumstances.

## Runtime storage

For an independently configured Sites installation, account current is stored in D1 under a stable authenticated identity. Device-local drafts and replaceable market/FX caches are separate. The provider build cannot read or write that account current; its legacy browser interface retains local data for explicit user-controlled export.

The `?fixture=ready` synthetic view works only under `npm run dev`. It is unavailable in compiled builds, including the compiled demo. Do not replace it with real holdings to prepare public screenshots or test evidence.

Use only your own isolated resources for an independent installation. This repository does not authorize changing another service's source, access, storage, or secrets. Applied schemas and user state require their own reviewed recovery and compatibility plan.

## Credentials and requests

Alpaca, DeepSeek, and OpenAI credentials remain server-only, in ignored local environment files or managed sensitive environment variables. The committed [environment template](.env.example) contains placeholders. Never use `NEXT_PUBLIC_` or `VITE_` for secrets.

Provider requests use fixed upstreams, bounded input/output, timeouts, and exact-origin browser rules. **CORS and Origin checks are not server-side caller authentication.** An authenticated Sites page does not authenticate requests sent to a separate provider endpoint; a non-browser caller can bypass browser CORS enforcement and supply an Origin header.

The included process-local rate limiter is best-effort. Its state is neither shared across instances nor durable across restarts, so it is **not a shared quota or hard spending cap**. Request validation, timeouts, no-store, and hiding keys from browser bundles do not close that billing-abuse boundary.

Before making an independently owned provider publicly reachable with paid credentials, implement and verify server-side caller authentication/authorization, shared rate and usage limits, bounded concurrency/request cost, and provider/account budget controls with an enforceable stop path. Keep paid routes disabled or unconfigured until those controls are in place. This snapshot does not claim that the complete authentication, distributed quota, or hard-spend-cap system is implemented.

The account-current route separately requires Sites identity, same-origin writes, strict validation, and compare-and-swap protection. That protects account state; it does not automatically protect separately exposed paid provider calls. Do not log sensitive request/response bodies.

## AI data boundary

In the `production` experience, opening Portfolio analysis triggers its analysis request. In `research`, interpretation starts only after the explicit start action. Opening chat sends no request in either experience; submitting a question sends the current USD portfolio snapshot through the provider server to DeepSeek.

That snapshot includes instruments, quantities, cost, valuation, P/L, cash details, and quote metadata. It excludes names, emails, brokerage account identifiers, device identifiers, historical databases, backups, drafts, clipboard contents, and internal storage metadata. Chat and analysis requests, raw responses, and real answers must not be written to analytics, logs, exports, issues, or persistent app storage. Dialog state is cleared when closed.

Model output is untrusted. Strict schemas, evidence allowlists, deterministic number rendering, and trade-language checks apply. AI cannot mutate portfolio data. Framework language does not establish verified investment advice or affiliation.

## Research and external handoff

The issuer-research route accepts only a supported AAPL/MSFT symbol and bounded question. The UI experience switch is not an endpoint access-control mechanism; server configuration controls provider availability independently. Keep unused model routes explicitly disabled or unconfigured. SEC retrieval uses fixed endpoints and a server-configured identifying User-Agent. OpenAI Web Search is restricted to SEC and issuer domains and uses `store: false`; that flag is not a claim about all provider retention policies. Synthesis receives the bounded Evidence Ledger without tools. Web content remains untrusted.

The separate “copy and open ChatGPT” action puts selected portfolio text in a ChatGPT URL and clipboard. It is an explicit external handoff, not a local-only operation and not an automatic message send. Full prompt URLs must never enter application logs, analytics, caches, or public test evidence.

## Dependency maintenance

Keep the committed lockfile and the high-severity audit gate. Prefer official patched releases; do not force a framework downgrade or suppress an advisory to make CI pass. When an upstream fix is unavailable, any maintained local backport must preserve its license and provenance, document the remaining scope, and include regression tests against the actual installed consumer. The [braces backport](vendor/braces/README.md) records this temporary obligation. Raw `npm audit` continues to report the affected upstream version. `npm run audit:security` accepts only the documented remediated advisory after source-hash, development-only path, actual installation and regression verification. All other high/critical findings, source drift and incomplete/network-error audit results remain blocking. Both target builds and built smoke checks remain required. Retire the backport after an official repaired release has been reviewed and validated.

## Publication checks

Run `npm run public:check`; after builds, run `npm run bundle:check`. In a full, readable checkout, run `node scripts/public-history-audit.mjs` to inspect every locally reachable ref and HEAD, including file paths/content, commit author/committer/message metadata, and annotated tags. The rules cover credential patterns, non-example contact addresses, selected identifying prose, machine paths, and deployment identifiers. Incomplete shallow history is rejected.

CI can inspect only the branches/tags fetched into its checkout. Pull-request refs require a separately prepared audit mirror that explicitly fetches them; inaccessible remote refs, platform commit caches, discussions, release attachments, and external copies need separate review. These checks complement manual prose/image review and do not prove that previously distributed copies have disappeared.

Keep recovery bundles, raw audit output, private configuration, and release mappings in ignored private storage. Source history and public surfaces need separate checks whenever publishing changes. A new commit alone does not remove an older public object or a distributed copy.

## Reporting

Do not attach sensitive data to a public issue. Use the repository's private vulnerability-reporting channel if available; otherwise contact the maintainer to arrange a private channel before sharing details.
