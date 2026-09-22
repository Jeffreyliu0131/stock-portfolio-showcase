# Acceptance criteria

These are pass/fail requirements, not a record that any specific deployment has passed. Use synthetic data unless a separate, explicit live-data check is authorized. Test strategy and evidence limits are in [06-TEST-STRATEGY.md](06-TEST-STRATEGY.md).

## Calculation and current state

| Given / when | Required result |
|---|---|
| Multiple cost inputs for one normalized instrument are combined | Sum quantity and total cost first; derive average cost from those totals using Decimal |
| Display currency or precision changes | Original USD quantities, cost, cash, ratios, and stored state remain unchanged |
| A stock lacks a price or previous regular close | Affected values stay unknown; partial coverage is explicit; no zero replacement |
| Positive and negative daily effects offset | Signed contributors remain visible; absolute contribution uses the sum of absolute effects, not net P/L |
| A snapshot is added, edited, or deleted | Correct append/replace/delete semantics; no other instrument changes; failure preserves current |
| A broker baseline is previewed and cancelled | No book creation or legacy-store changes |
| A valid BUY or SELL is confirmed | Selected source quantity/cost, signed combined cash delta, and event commit atomically |
| A SELL closes only one source position | The other source remains unchanged and the aggregate row remains when it has quantity |
| A trade oversells, repeats an event ID, or uses a stale revision | The complete operation is rejected with zero change |
| Pending, negative, or non-IBKR cash is present | It contributes to combined assets as defined; it does not gain positive IBKR settled-cash interest |

Reference formulas and synthetic cases are in [02-DOMAIN-AND-CALCULATIONS.md](02-DOMAIN-AND-CALCULATIONS.md).

## Storage and restore

- Given an unauthenticated Sites request, account current is unavailable; authenticated state is isolated by user key.
- Given provider-target GET or POST `/api/portfolio`, including forged identity headers, respond 404 without D1 access.
- Given two writes using the same state revision, at most one succeeds; the other reports conflict without overwriting.
- Given a valid JSON v2/v3 file, parsing and preview produce no writes. Confirmation succeeds only when stock, cash, and broker current are all empty at the atomic write boundary.
- Given an invalid item, unknown field, ambiguous instrument, wrong format, nonempty target, cancellation, or concurrent restore, reject the whole operation without partial state.
- A successful restore creates fresh revision-one current with no previous versions; source revisions are only validated. No original file, draft, quote/FX cache, history store, outbox, or cursor is restored.
- Export/share/download success, failure, and cancellation are read-only. A generated-file timestamp does not claim durable external saving.
- A new empty runtime starts empty without automatic writes. Existing D1 state, old-origin IndexedDB, applied SQL migrations, and dormant history data are not reset or silently migrated.

## Market and FX

- Quote metadata retains actual feed, event time, acquisition time, and price type. Overnight indicative trades are not described as SIP or executable prices.
- Provider failure preserves a qualifying last-valid quote and its timestamps; an unpriced asset stays unknown.
- Intraday points come from delayed real bars and have complete required references; failures or insufficient points produce an unavailable chart, not invented history.
- FX first attempts its configured primary path, then same-day ECB cross rates. Qualified cached FX retains source metadata; an invalid/expired rate disables CNY and leaves USD usable.
- Market/FX requests contain no quantities, cost, cash, account current, or backup bodies.

## AI and external handoff

| Trigger | Required result |
|---|---|
| Open analysis in `production` | One initial schema-v3 request under the existing production behavior; no duplicate StrictMode request |
| Open analysis in `research` | Zero model requests; deterministic contribution and structure available |
| Explicit research interpretation start/rerun | Capture the chosen current snapshot; rerun only on explicit action |
| Open chat in either experience | Zero model requests and usable focused input |
| Submit first chat question, then refresh market data and submit a follow-up | Reuse the first-question snapshot for that dialog; bounded successful history only |
| Close/reopen a dialog | Clear its session; new context is captured only at the relevant new request |
| Provider unavailable, timeout, invalid schema, invented number, unknown evidence, or direct trade instruction | Safe error; no partial unvalidated model output; deterministic content and financial state preserved |
| Issuer-research request | Only supported issuer/question; no portfolio data; official-source evidence and deterministic metrics |
| Missing owner-earnings assumptions or incomparable fiscal periods | Explicit evidence/assumption gap; no fabricated derived metric |
| Copy-only versus copy/open-ChatGPT | Same selected USD facts; no asset mutation; only the latter requests external navigation; neither automatically sends a message |

Production must not acquire a research entry, v4-only user flow, or additional model provider solely because source files are maintained or rebuilt.

## Release and device checks

A releasable build must match its clean committed source, canonical/mirror mapping, exact wiring, artifact manifest, migration set, and uploaded archive. CI/demo/check-mode output cannot pass as a production release. Recheck actual remote branch HEAD, platform access, and configured data bindings separately.

For an existing installation, retain domain, app identity, owner-only access, D1 binding/schema/data, provider secrets, legacy export path, PWA icon origins, and protocol compatibility. A failed UI/provider release uses a recorded prior deployment/version; it does not restore or reset account data.

Device acceptance includes Safari and standalone mode, installation icons, storage retention, file export/restore, chat/copy routing, 200% text, VoiceOver, reduced motion, focus, keyboard, and cross-device conflicts. Responsive renderings, mocked provider tests, and HTTP 200 are insufficient evidence for those claims. Real holdings are privately reconciled by the account owner; automated smoke must not read or mutate them.
