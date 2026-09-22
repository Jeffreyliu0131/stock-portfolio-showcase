# Architecture and technical contract

The repository has one business source tree with build-time runtime and experience selectors. Product scope is in the [PRD](01-PRD.md); financial semantics are in the [domain contract](02-DOMAIN-AND-CALCULATIONS.md).

## Components and responsibility

| Source | Responsibility |
|---|---|
| [domain](../domain/) | Framework-independent Decimal calculations, position/cash/trade invariants, market and trend semantics |
| [application/positions](../application/positions/), [cash](../application/cash/), [brokerage](../application/brokerage/) | Repository and backup contracts; current projections |
| [application/cloud](../application/cloud/) | Strict account state, API parsing, browser repository, and D1 persistence |
| [application/market-data](../application/market-data/), [instruments](../application/instruments/), [fx](../application/fx/) | Fixed provider adapters, browser clients, freshness and cache boundaries |
| [application/ai](../application/ai/) | Portfolio protocols, provider executors, strict outputs, and issuer-research pipeline |
| [components](../components/) and [ui](../ui/) | Controllers, forms, dialogs, deterministic view models, copy text, and synthetic fixture views |
| [app](../app/) | Next.js App Router pages and server routes |
| [db](../db/) and [drizzle](../drizzle/) | D1 schema binding and immutable generated migrations |
| [scripts](../scripts/) | Explicit builds, source fingerprints, release mapping, artifact verification, and smoke checks |

## Runtime boundary

```text
Sites dispatch authentication
  -> App Router pages / browser repository
  -> same-origin account API
  -> user-partitioned D1 current with CAS

Sites browser provider requests
  -> fixed provider origin, without credentials
  -> strict API / fixed upstream adapters
  -> market data, FX, portfolio AI

Provider legacy page
  -> same-origin IndexedDB current
  -> explicit user-controlled JSON export
```

The `sites` target uses Vinext/Vite and Worker-compatible output. The `provider` target uses Next.js server output. The `demo` target uses local review wiring. [Build-target selection](../application/runtime/build-target.ts) and the [build wrapper](../scripts/build-target.mjs) select policy without copying business logic into separate apps.

The provider target returns 404 for GET and POST `/api/portfolio` before identity or D1 access, even if a request supplies forged platform headers. Its retained legacy interface uses local IndexedDB and does not gain Sites account access. Sites does not serve provider endpoints as an alternate secret-bearing implementation.

## Authentication and stored state

Sites page access depends on authenticated platform dispatch; account APIs enforce identity again. A forwarded stable user ID is preferred. The compatibility fallback hashes normalized authenticated email into a stable pseudonymous key; the original email is not written to D1. A hash is pseudonymization, not guaranteed anonymity. These headers must never be trusted on a directly exposed, unauthenticated Worker.

D1 `user_portfolios` stores strict versioned current state under the user key, with `state_version` compare-and-swap protection. Legacy positions/cash and an optional calibrated broker book retain business revisions, previous state, and next revisions. A stale state or business revision, invalid payload, or write failure leaves the complete stored state unchanged.

API parsing rejects unknown fields, invalid decimals, invalid instruments, oversized bodies, invalid revisions, and conflicting event IDs. Writes require same origin and bounded request processing. Account responses use private/no-store headers. SQL migrations already applied to an installation and their journals/snapshots are immutable; runtime code must not create/reset schema.

## Device and legacy storage

Sites uses device-local storage for drafts, last-valid quotes, FX cache, and safety hints. Those are not the account's financial source of truth. The provider's legacy IndexedDB snapshot/cash/book stores stay available on that origin. Browser origin isolation prevents the Sites app from directly reading another origin's data.

Moving data between these environments requires user-controlled JSON export and strict empty-target restore. No automatic upload, presumed account attribution, schema reset, seed, backfill, or store deletion is part of ordinary source maintenance. JSON restore follows the [domain rules](02-DOMAIN-AND-CALCULATIONS.md).

Dormant history parsing, historical-return calculations, and synchronization modules remain isolated from the active page path. `/history` redirects to the home page; the controller does not automatically record NAV. A tested dormant module is not an enabled feature. Retained local history is not grounds for uploading or deleting it.

## Provider and browser security

The configured Sites browser origin may call a fixed provider origin with exact-origin CORS and no cookies/authorization credentials. Preflight permits only the required method/headers; API access is not granted through wildcard CORS. CSP restricts provider connections to that origin. These browser controls are not authentication or a complete abuse-prevention system.

Provider routes constrain fields, actual request bytes, supported instruments, upstream origins, redirects, timeouts, response size, and per-instance rate limits. Limits are best-effort across independently scaled instances. Credentials remain server-only. No portfolio account body, raw JSON backup, revision, draft, or D1 key belongs in market or FX requests. Portfolio AI intentionally receives the bounded current snapshot described in [AI-SYSTEM.md](AI-SYSTEM.md).

PWA icons are a separate public static exception: versioned PNGs under `/icons/` allow anonymous cross-origin image loading and immutable caching. API wildcard access is not implied. Manifest identity/start URL remains the Sites origin, and authenticated pages do not become public because their icons are public.

## Experience and wire compatibility

`production` preserves the two-entry presentation and schema v3. `research` enables optional interpretation, framework-advisor presentation, and separate issuer research with schema v4. The browser adapter selects the wire version; the provider strictly parses either version, chooses the matching prompt policy, validates structured results, and returns the requested version.

The shared adapter normalizes v3 internally without discarding unknown request fields. It removes v4-only response additions when returning v3. This compatibility allows separately deployed UI and provider versions to retain the established v3 contract. It does not authorize changing model settings, exposing research in production, or skipping cross-version tests.

## Source and artifact integrity

A build captures the source revision and content fingerprint before compilation, clears its target output, and verifies unchanged source after compilation and artifact collection. Only recognized framework-generated type/config edits can be restored. Compiler failure or source drift prevents a new seal.

Release preflight requires a clean committed source, exact configuration, a fresh deployable build, canonical mapping where applicable, and a complete content/size manifest of publication files. It rejects changed/missing/extra files and unsafe filesystem entries. Validated internal Vercel adapter aliases have a narrowly scoped exception; source and Sites output cannot use symlinks.

The Sites publication repository is a file projection of canonical source with only a validated private hosting overlay and source map. It is not another business development branch. The canonical commit and actual mirror commit are distinct identities and must be recorded as such. See [operations](09-PRODUCTION-OPERATIONS.md) for the exact workflow and rollback boundary.
