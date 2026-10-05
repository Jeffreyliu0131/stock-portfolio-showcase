# Test strategy

This independent showcase has no connected production deployment. Use synthetic data and record results against the exact source and artifact tested. These methods validate the included snapshot; they do not certify another service, live model quality, or a complete public paid-API security boundary.

## Local and CI gates

Use Node.js 22 and the committed dependency lockfile:

```sh
npm ci
npm run verify
npm run audit:security
npm run build:ci
npm run bundle:check
npm run smoke:built
```

`verify` runs the public-boundary audit, typecheck, Vitest suite, release-tool tests, synthetic research eval, and domain build. Domain build clears `dist`; run it before building Sites. `build:ci` validates both runtime targets with synthetic wiring and non-deployable check mode. It does not require copying private deployment configuration into CI.

Default `npm run build` and `npm start` select the local demo. Test the development fixture separately: `?fixture=ready` is available only under `npm run dev`, never in the compiled demo or another compiled target.

For separately authorized installations in your own isolated resources, use the explicit provider/Sites build gates in [operations](09-PRODUCTION-OPERATIONS.md). These examples do not authorize changing the source of an existing service. Build targets share generated framework types, so run builds sequentially. A passing unit test does not replace a target build or artifact check.

Dependency audit and verification run as independent CI jobs; either failure keeps the workflow failed. New dependency advisories therefore leave test/build results visible. The maintained [braces security backport](../vendor/braces/README.md) is covered by the release-tool suite, including actual installed resolution, malicious string/AST rejection, normal expansion and the dynamic-import build consumer. Raw registry version findings remain visible; the maintained patch is accepted only after its source and regression checks pass.

## Coverage responsibilities

| Area | What meaningful tests establish |
|---|---|
| Decimal and domain | Fractional inputs, quantity/cost aggregation, no intermediate display rounding, signed cash, BUY/SELL cost/cash formulas, and unknown-value semantics |
| Repository/backup | Atomic current replacement, revision conflicts, previous-state safeguards, strict formats, no-write preview, empty-only restore, and failure rollback |
| D1 integration | Real SQLite execution of the committed migration, account partitioning, concurrent CAS, and stale-write zero change |
| Legacy compatibility | Existing snapshot/cash/book state remains readable; active writes do not delete unrelated stores or silently promote dormant history |
| Provider routes | Exact origin/schema boundaries, request bytes, fixed upstreams, timeouts, process-local limits, cache semantics, and no account-current access; these do not establish caller authentication or a hard spending cap |
| AI contracts | v3/v4 adaptation, production trigger behavior, strict evidence references, numeric-claim rejection, safe failure, fixed chat snapshot, and no financial mutation |
| Research replay | Official-domain controls, SEC period selection, Evidence Ledger, no portfolio data, deterministic metrics, and owner-earnings assumptions |
| Components | Clear pending/error/partial states, explicit research triggers, zero-request chat opening, focus behavior, trade/restore previews, and copy fallbacks |
| Release tooling | Source drift, failed builds, stale seals, content changes, missing/extra artifacts, unsafe links, mirror overlays, and canonical mapping failures |

Tests use synthetic trees, SQL state, market payloads, model responses, and browser storage. Test files are executable detail for the [acceptance criteria](05-ACCEPTANCE-CRITERIA.md); adding a shallow test that only repeats an implementation statement is not evidence of a user outcome.

## Built-artifact smoke

The local smoke exercises actual built target routes: provider account-current refusal, allowed/disallowed preflight, legacy page and public icon headers, Sites anonymous-account denial, protected-page behavior, and absence of a Worker provider route. Keep emulation databases and logs outside sealed publication output.

Synthetic visual checks should include 320/390/1280 px, long financial values, missing quotes, cash, failures, modal focus, shared horizontal scrolling, and absence of page overflow. [smoke-demo.mjs](../scripts/smoke-demo.mjs) is a separate browser smoke helper; retain screenshots and raw browser output in ignored storage. A component interaction test and a visual render are different evidence.

## Privacy verification

`public:check` and `bundle:check` cover automated publication patterns and browser artifact boundaries. Run `node scripts/public-history-audit.mjs` in a full, readable checkout to audit file paths/content and commit/tag metadata reachable from all local refs and HEAD. It checks author/committer/message fields, selected identifying prose, non-example contact addresses, credentials, machine paths, and deployment identifiers; shallow history fails closed.

The [CI workflow](../.github/workflows/security.yml) sees only its fetched branches/tags. A separate audit mirror must explicitly fetch pull-request refs to include those objects. Remote refs it cannot access, platform caches, discussions, release attachments, and existing outside copies remain separate inspection surfaces. Review prose and image content/metadata manually as well. Do not print suspected sensitive values into a public log or report.

A current-tree scan alone cannot establish that older commits, pull-request refs, cached pages, or outside clones are clean. Privacy remediation requires its own authorized backup, all-ref inspection, reviewed replacement, and platform follow-through; keep raw evidence private.

## Independent-installation security evidence

CORS/Origin rejection is browser-policy evidence, not proof that an arbitrary server-side caller is authenticated. Process-local limiter tests do not prove shared multi-instance quotas, restart-safe usage accounting, or an enforceable budget cap. An installation exposing paid provider calls must add and separately verify caller authentication/authorization, shared usage/rate limits, bounded concurrency/request cost, and a budget stop path. The showcase does not claim those protections are already implemented.

## Live and device evidence

Live market-data smoke should use supported synthetic instrument requests and inspect schema, provider/feed/time semantics, FX, failure behavior, and response headers. Do not use real account-current reads for smoke. Real AI calls require explicit consent and an agreed cost boundary; otherwise mark them untested. A homepage success does not prove market data, AI, or account integrity.

Synthetic research eval cannot prove fresh retrieval, citation entailment, model judgment, user comprehension, or investment outcomes. Those require separate source-backed and human review. Device checks must separately cover iPhone install, Safari/standalone behavior, VoiceOver, clipboard/share/file flows, long prompt routing, cross-device refresh/conflict, and private account reconciliation.

The presence of a Playwright dependency or a `test:e2e` script is not proof that a complete end-to-end suite exists or passed. Report what was actually run, any failing/omitted checks, and the precise boundary of each result.
