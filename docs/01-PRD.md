# Product contract

## Purpose

Help a user understand a manually maintained portfolio: current value, remaining cost, cash, concentration, estimated daily price effect, and data coverage. Exact calculations provide the financial facts; AI is an optional interpretation layer. The interface is optimized for iPhone browsers and home-screen use.

The supported instrument set is USD-denominated US-listed stocks and ETFs accepted by the instrument resolver, including supported depositary receipts. OTC securities, options, crypto, non-US markets, tax accounting, trading execution, and automatic brokerage connections are outside scope.

## Portfolio maintenance

The home view combines positions by instrument. It does not expose freely created broker accounts or a broker-based portfolio filter. Two storage-compatible maintenance modes coexist:

- **Snapshot mode:** multiple quantity/cost inputs form one current batch per instrument. Ordinary entry and add-position actions append inputs; editing replaces the batch with the submitted values. Delete requires confirmation. Previous versions are storage safeguards, not a home-screen undo feature.
- **Broker book mode:** explicit calibration establishes current source quantities, remaining costs, and signed settled/pending cash for the fixed `IBKR` and `MOOMOO` source codes. Subsequent manual BUY/SELL entries update the selected source position, cash, and event atomically. A calibration must not infer missing source allocations from aggregated snapshots.

Broker names are supported data-model values, not assertions about any operator's investments. Manual trades update this application's records only; they do not send brokerage orders. Every supported symbol uses the same trade and cash rules. The home view shows one combined cash balance while the underlying components remain compatible with existing storage and interest calculations.

The [domain contract](02-DOMAIN-AND-CALCULATIONS.md) defines all formulas, revisions, and failure semantics.

## Valuation and coverage

- Stocks use delayed Alpaca market data with explicit feed and source-time semantics. Market data changes valuation, never quantity or cost.
- USD remains the financial source currency. CNY is a derived display using one valid rate; inputs, backups, and copied facts retain USD values.
- Missing prices are unknown, not zero. Partial valuations and contribution coverage must remain visible.
- Daily P/L is the estimated price effect of current quantities relative to the previous regular close. It is not realized P/L or cash-flow-adjusted performance.
- The intraday chart uses real delayed SIP bar timestamps. It cannot manufacture prices or imply a validated long-term performance history.
- Cash principal contributes to total assets. Estimated interest is displayed separately and never added to principal without a recorded balance change.

## Runtime and storage

| Target | Current-state responsibility |
|---|---|
| Sites | Authenticated per-account D1 state with revision and compare-and-swap protection |
| Provider | Market/FX/AI endpoints and legacy same-origin IndexedDB interface; no account-current API |
| Demo | Local review with example wiring and optional labelled synthetic fixtures |

Sites access remains owner-only for an existing owner-only installation unless an explicit access change is authorized. Its identity boundary and D1 data cannot be replaced by origin checks. Legacy browser data remains in its original origin; source maintenance does not upload, delete, or migrate it.

JSON v2/v3 export creates a manual current-only copy. Restore is user-triggered, fully validated, previewed, and confirmed; the target's stock, cash, and broker current must all be empty. Restoration is atomic and cannot merge into or overwrite a populated account. Export completion does not prove that the user saved a durable external copy.

## Experience variants

Experience selection is independent of runtime target and is set at build time.

| Behavior | `production` | `research` |
|---|---|---|
| Portfolio analysis | Opening triggers the existing initial analysis; deterministic structure/contribution remain available | Opens with deterministic daily contribution and structure; an explicit start/rerun action requests interpretation |
| Chat | “AI 对话”; opening makes no request | Value-investing framework advisor; opening makes no request |
| AI wire protocol | v3 | v4 |
| Snapshot presentation | Existing production presentation | Explicit snapshot time/change notices and controlled rerun |
| Issuer research | No research entry | Separate AAPL/MSFT research entry |

Chat freezes the current snapshot when the first question is sent and reuses it with bounded recent dialog turns. Closing clears the session; opening and sending again creates fresh context. Portfolio refreshes do not silently become new model requests. The provider supports strict v3 and v4 parsing without duplicating portfolio business logic.

The framework advisor is a simulation of public value-investing principles, with no claim of affiliation or impersonation. It identifies evidence gaps rather than fabricating business quality, owner earnings, valuation, or trade recommendations. Issuer research sends only a supported symbol and question, then uses primary-source evidence and deterministic numeric calculations. See [AI-SYSTEM.md](AI-SYSTEM.md).

## User-controlled outputs

“Copy only” writes the chosen current facts to the clipboard. “Copy and open ChatGPT” uses the same text and opens a prefilled prompt URL. Neither action sends a chat message automatically or changes assets. The external handoff must not be described as local-only. User cancellation, unavailable sharing/clipboard APIs, long URLs, and provider failure require usable fallbacks.

## Non-goals and acceptance

No Service Worker, complete offline application shell, offline account editing, cross-account sharing, unattended data migration, automatic versioned cloud backup, long-term return chart, active statement-import flow, or automatic brokerage synchronization is promised. Dormant history/sync modules must not be connected to active writes by routine maintenance.

Acceptance is defined in [05-ACCEPTANCE-CRITERIA.md](05-ACCEPTANCE-CRITERIA.md). Automated and synthetic results are distinct from live provider quality, physical-device usability, real account reconciliation, or investment outcomes. None is implied by publishing this source.
