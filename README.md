# Stock Portfolio Showcase

An independent source snapshot for code review, technical learning, and local synthetic demonstrations. This repository is not the development source for a running service and has no connected production deployment.

The included iPhone-first portfolio PWA demonstrates exact Decimal calculations, delayed-market-data adapters, account-isolated storage contracts, and optional AI interpretation. Its primary task is understanding current value, concentration, estimated daily price effect, and missing-data coverage.

The application records and values assets. It does not connect to a brokerage account, execute trades, calculate tax returns, or promise investment performance. AI explains a bounded snapshot; it cannot change portfolio state or supply missing prices.

[Run locally](#run-locally) · [Product contract](docs/01-PRD.md) · [Calculations](docs/02-DOMAIN-AND-CALCULATIONS.md) · [AI system](docs/AI-SYSTEM.md) · [Operations](docs/09-PRODUCTION-OPERATIONS.md)

## Included runtime targets

| Target | Responsibility |
|---|---|
| `sites` | Authenticated application and per-account D1 current state; device-local drafts and replaceable caches |
| `provider` | Market data, FX, AI service boundaries, public PWA icons, and a legacy local-data export interface; no account-current API access |
| `demo` | Default local build/start target using example origins; synthetic query fixtures are available only in development mode |

Experience is a separate build setting:

| Experience | Analysis and chat |
|---|---|
| `production` | Two entries: opening Portfolio analysis triggers the existing analysis request; opening AI chat sends nothing until a question is submitted. Clients use AI wire schema v3. |
| `research` | Deterministic daily contribution first; interpretation starts only on explicit request. Adds a value-investing framework advisor and separate AAPL/MSFT issuer research. Clients use schema v4. |

The local demo defaults to `research`. The `production` name denotes an included experience variant, not a deployment attached to this repository. Explicit provider/Sites build targets remain available for technical study and independently owned installations; all targets share business modules and JSON v2/v3/revision contracts. Do not point an existing service at this showcase snapshot to follow the examples.

## Calculation and data boundaries

- Quantities, cost, cash, fees, valuations, FX, and intermediate financial values use Decimal arithmetic. Display rounding never becomes a stored financial value.
- The home view aggregates by instrument. Broker-specific quantities and remaining cost support manual BUY/SELL records; cash is displayed as one portfolio total.
- Missing market values remain unknown. Daily price effect uses current quantities and the previous regular close; it is not cash-flow-adjusted investment performance.
- JSON restore validates the entire file, previews it, and writes only to an entirely empty target. Validation errors, conflicts, and write failures leave state unchanged.
- Sites account data is isolated in D1. A provider build rejects account-current API access, including forged identity headers. Legacy browser data is not automatically uploaded or migrated.

See the [domain contract](docs/02-DOMAIN-AND-CALCULATIONS.md) and [architecture](docs/04-TECHNICAL-SPEC.md).

## AI boundary

If a model provider is configured and an AI action is triggered, portfolio analysis and chat send the current USD snapshot through the provider server to that model. This includes instruments, quantities, cost, valuation, P/L, cash, and quote metadata. Identity fields, brokerage account identifiers, device identifiers, storage internals, historical databases, backups, drafts, and clipboard contents are excluded. Conversation state stays in the open dialog's memory.

The research experience uses public value-investing principles without impersonating Warren Buffett or claiming affiliation. Its separate issuer-research request contains only an AAPL/MSFT symbol and question. SEC/XBRL and issuer-domain research feed an Evidence Ledger; deterministic calculations own numerical results, and synthesis has no tools. Missing evidence remains a gap.

Schemas, evidence allowlists, bounded retries, request limits, and output validation constrain model behavior. Synthetic tests demonstrate contract behavior, not live citation quality, advice quality, adoption, or financial outcomes. See the [AI contract](docs/AI-SYSTEM.md).

## Run locally

Use Node.js 22 and the committed lockfile:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The environment template contains placeholders and keeps AI disabled. With **`npm run dev` running**, append `?fixture=ready` to the local development URL for a labelled synthetic view that makes no account/provider requests. **That query fixture is development-only; it is unavailable in a compiled build, including the compiled demo.**

To inspect the compiled local demo:

```sh
npm run build
npm start
```

Both default commands select the demo target. The compiled demo does not automatically load the development fixture. These commands do not publish a service or connect this repository to a deployment.

Provider secrets belong only in ignored local configuration or managed server environment variables; never use `NEXT_PUBLIC_` or `VITE_` for them. Before an independent public installation, review [SECURITY.md](SECURITY.md): CORS is not caller authentication, and process-local rate limits are not a shared quota or hard spending cap. The included provider routes require additional deployment-level safeguards before exposing paid upstream access. [Operations](docs/09-PRODUCTION-OPERATIONS.md) explains the build/release mechanism for independently owned installations.

## Verification

```sh
npm run verify
npm run audit:security
npm run build:ci
npm run bundle:check
npm run smoke:built
```

`verify` includes the public-boundary gate, typecheck, tests, release-tool tests, synthetic research eval, and domain build. CI uses synthetic deployment wiring; its artifacts are not deployable releases. The [verification workflow](.github/workflows/security.yml), [acceptance criteria](docs/05-ACCEPTANCE-CRITERIA.md), and [test strategy](docs/06-TEST-STRATEGY.md) define the evidence and its limits. Test results apply only to the revision actually tested.

## Documentation

The [document map](docs/00-DOCUMENT-MAP.md) links the included product, calculation, UX, architecture, acceptance, testing, AI, and release contracts. They explain this snapshot; they are not a status report or operating instructions for another service. Deployment identifiers, private operating records, credentials, and user data belong outside public source. Review [SECURITY.md](SECURITY.md) before publishing changes or reporting a vulnerability.

## License

No open-source license is granted. The source is public for review and technical discussion; all rights are reserved.
