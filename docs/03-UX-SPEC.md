# UX contract

This document defines visible behavior and acceptance requirements. It does not certify a physical device, browser, or assistive-technology test. Financial meanings come from the [domain contract](02-DOMAIN-AND-CALCULATIONS.md); feature variants come from the [product contract](01-PRD.md).

## Home and valuation

The home screen prioritizes total assets, estimated daily change, the available intraday trend, and a compact summary of stock P/L, daily P/L, stock cost, and cash. A continuous five-column holdings table presents instrument identity, value/quantity, valuation price/average cost, cumulative P/L/return, and daily rate/amount. Instrument identity stays fixed while the table shares one horizontal scroll position.

Use one page-level delayed-price disclosure. Missing values remain visibly unavailable; request failures may use a compact page-level message. Do not label delayed prices, estimated daily P/L, or the chart as real-time execution prices or realized investment performance. Positive/negative amounts retain signs and text even when color is used.

USD/CNY display switching changes money presentation only. Ineligible or missing FX leaves USD usable. The cash row shows one combined portfolio cash balance; interest detail retains its narrower eligible-balance scope. The chart displays real available points and an honest unavailable state when it cannot draw them.

Stock rows support click, stationary long-press, and keyboard-equivalent actions. Horizontal movement cancels long-press and suppresses the following accidental click without trapping vertical scrolling. The page itself must not overflow horizontally; table scrolling is intentional.

## Entry, calibration, and trades

Snapshot entry resolves a supported symbol, preserves decimal text, and offers average-cost or total-cost input. For an existing instrument, normal entry/addition previews current inputs, new inputs, and combined results. Edit clearly replaces the current batch with submitted aggregate values. Do not present an appended snapshot input as an executed trade.

Broker calibration previews explicitly entered source quantities/costs and settled/pending cash. Activating it changes the current projection only after a successful write. BUY/SELL forms show the selected source's available quantity, quantity/cost changes, and combined cash before/after. They do not require choosing a separate spendable cash account. Overselling, invalid fees, and stale revisions block submission.

During submission, prevent duplicate actions. On failure, retain the draft and existing current. Destructive deletion requires confirmation and a clear target. A conflict prompts refresh/review rather than silently overwriting another device.

## Data safety and restore

The UI must describe the actual runtime: account current on Sites, browser-local current on the legacy provider/demo path. Do not claim cloud sync after a local write or claim that account storage is only local.

Export generates a read-only current-only JSON v2/v3 copy, using file share where available and download fallback otherwise. Cancellation and failure do not mutate assets. Generation time is a hint, not proof that a durable backup was saved.

Restore first validates and previews the complete file, then requests confirmation. Explain the empty-target requirement and reject any populated stock/cash/broker current. No partial success, silent merge, or overwrite is allowed. A successful restore reloads current from the repository; market/FX data is refreshed normally rather than restored from the file.

Device persistence status may be `persistent`, `best-effort`, `unsupported`, or `unknown`. API errors and indeterminate results stay unknown. Persistence permission is not a substitute for a saved external copy.

## Analysis and chat

| Flow | `production` | `research` |
|---|---|---|
| Open Portfolio analysis | Starts the existing initial analysis once; deterministic sections remain usable | Shows daily contribution and structure without a model request |
| Start/rerun interpretation | Existing production interaction | Explicit action freezes the snapshot and sends; data refresh does not automatically rerun |
| Open chat | Focuses input; zero model requests | Focuses framework-advisor input; zero model requests |
| Submit first question | Captures current context | Captures current context and shows snapshot/data boundaries |
| Follow-up | Reuses fixed first-question snapshot with bounded dialog memory | Same fixed-snapshot rule, with visible snapshot-change explanation |
| Issuer research | No entry | Separate symbol/question flow; opens without a request |

Analysis loading/failure must not hide deterministic calculations or modify assets. Chat failure retains the draft. Closing clears conversation/session state and returns focus predictably. A new chat session captures fresh context only when a question is sent.

Research presentation identifies method simulation, AI-inferred classification, evidence limits, and current-only data scope. Snapshot capture time must not be labelled as quote time. Classification is not an official security classification, risk rating, or trade recommendation. See the [AI contract](AI-SYSTEM.md) for payload and response boundaries.

## Copy and external handoff

The “more” menu offers copy-only and copy/open-ChatGPT destinations. Scope choices include all, top 5, top 10, and a single position where applicable; avoid duplicate choices when scopes coincide. Rank by unrounded USD market value, put unpriced instruments last, and retain a stable identifier order for ties.

Both destinations use the same selected USD facts and avoid mutation. Copy-only stays in the application. The ChatGPT destination copies the text and requests a prefilled HTTPS prompt URL; the user still decides whether to send. Provide a manual copy/paste fallback when clipboard, navigation, app handling, prefill, or length limits fail. Never log the full prompt URL or call it local-only.

## Mobile and accessibility acceptance

- Target 320–430 CSS px, safe areas, keyboard appearance, and home-screen mode without hidden primary controls.
- Retain readable text and key values at 200% text size; use adequate touch targets, visible focus, labelled fields, and associated errors.
- Dialog focus, escape/close behavior, and focus return must work with keyboard and screen readers. Do not rely on color or animation alone.
- Respect reduced-motion settings. Chart exploration must provide an equivalent readable value path.
- PWA identity and start URL remain on the authenticated app origin. Versioned public PNG icons may use the configured provider origin; icons contain no user data.
- No Service Worker, offline account editing, guaranteed background refresh, or automatic OS icon replacement is promised.

Physical iPhone installation, Safari versus standalone storage behavior, VoiceOver, external app routing, long prompts, and cross-device conflicts require explicit device tests. A responsive screenshot or homepage HTTP success does not establish those outcomes.
