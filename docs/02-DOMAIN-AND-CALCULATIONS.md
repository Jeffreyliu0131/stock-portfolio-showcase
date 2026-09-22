# Domain model and calculations

This document owns financial semantics. All examples are synthetic. The source modules are [domain](../domain/), [portfolio state](../application/cloud/portfolio-state.ts), [cash projection](../application/cash/portfolio-cash.ts), and [backup contracts](../application/positions/position-backup.ts). UI and deployment changes must preserve these rules.

## Numeric and identity rules

- Financial inputs and API values are plain finite decimal strings. Quantity, price, cost, fee, cash, and FX input parsers support at most eight fractional digits where the input contract applies.
- Decimal arithmetic uses 80 digits of precision and half-up rounding. Do not use JavaScript `number` as a financial source value or round intermediate amounts to display precision.
- Canonical decimals remove redundant trailing zeros. Display rounding never writes back into quantity, cost, cash, price, or subsequent calculations.
- Instrument identity is normalized `listingMarket + symbol + currency`, not a display name. Supported instruments are resolvable USD US-listed stocks/ETFs; ambiguous or unsupported identities fail validation.
- Account identity partitions stored state. It is not part of the within-portfolio aggregation formula. Broker book positions use `broker + instrument` internally, while home rows aggregate by instrument.
- Persisted timestamps are validated RFC 3339 values. Market sessions use `America/New_York`; feed freshness retains server acquisition time separately from market event time.

## Snapshot maintenance

A position input has quantity and exactly one cost mode:

```text
AVERAGE_COST:   inputOpenCost = quantity × enteredAverageCost
TOTAL_OPEN_COST: inputOpenCost = enteredOpenCost
```

For one instrument:

```text
totalQuantity = Σ inputQuantity
totalOpenCost = Σ inputOpenCost
averageCost = totalOpenCost / totalQuantity    (totalQuantity > 0)
```

Average costs must not be averaged directly. Quantity and cost are nonnegative; an open position has positive quantity. A zero quantity has zero cost and no average cost.

Each instrument has one active snapshot batch. Ordinary entry/addition appends new inputs to the active inputs. Editing replaces the batch with the submitted aggregate quantity/cost input. These are current-state operations, not brokerage executions or inferred transaction history.

A complete next version is persisted atomically before becoming current. Revision conflicts and write failures leave current state unchanged. Previous state can be retained as a repository safeguard, but there is no home-screen version-restore action. Confirmed deletion removes only the selected position current/previous and attempts to remove its device-local draft; it must not alter other positions.

## Broker book, trades, and unified cash

A calibrated book contains revision, saved time, source positions, cash components, and bounded maintenance events. Source codes are fixed to `IBKR` and `MOOMOO`; they are schema values, not connected brokerage accounts.

```text
position = broker + instrument + quantity + totalOpenCost
cash = broker + settledBalance + pendingBalance
event = RECONCILIATION | BUY | SELL
portfolioCash = Σ(settledBalance_broker + pendingBalance_broker)
```

Settled and pending balances may be negative. Negative cash remains a liability, not zero. The UI, total assets, trade preview, copy, and AI context use the combined portfolio cash; internal components preserve settlement, interest, and backup compatibility.

Calibration validates an explicit source baseline and creates a new current revision. It does not guess a broker split from an aggregate snapshot or overwrite the legacy snapshot stores. Once a book exists, current display projects that book:

```text
quantity_instrument = Σ quantity_broker,instrument
openCost_instrument = Σ openCost_broker,instrument
averageCost_instrument = openCost_instrument / quantity_instrument
```

For a BUY of positive quantity `q` at positive unit price `p`, with nonnegative fee `f`:

```text
gross = q × p
quantityAfter = quantityBefore + q
openCostAfter = openCostBefore + gross + f
cashDelta = -(gross + f)
portfolioCashAfter = portfolioCashBefore + cashDelta
```

For a SELL, require `0 < q <= Q`, where `Q` and `C` are the selected source's pre-sale quantity and remaining cost:

```text
remainingQuantity = Q - q
remainingOpenCost = 0                          if remainingQuantity = 0
remainingOpenCost = C × remainingQuantity / Q   otherwise
cashDelta = q × p - f
portfolioCashAfter = portfolioCashBefore + cashDelta
```

Partial sales retain the source's moving-average cost. Full sales remove only that source position; another source's remaining position stays in the aggregate row. These formulas apply to every supported stock/ETF without symbol-specific cash rules. They do not implement FIFO, specified lots, realized tax P/L, short positions, or financing interest.

`SETTLED` or `PENDING` selects the internal cash component receiving the delta. Position, cash, and event changes commit together. Duplicate event IDs, invalid data, overselling, stale business revision, stale state revision, or persistence failure cause zero change.

IBKR interest fields apply only to eligible positive settled IBKR cash. If NAV uses `CASH_BALANCE_FALLBACK`, a settled trade keeps fallback NAV equal to `max(settledBalance, 0)`; nonpositive settled cash produces no interest estimate. Pending balances and MOOMOO cash never acquire IBKR interest merely by contributing to portfolio cash.

## Valuation and total assets

For a position with effective price `P`, quantity `Q`, and remaining cost `C`:

```text
marketValue = Q × P
unrealizedPnL = marketValue - C
unrealizedReturn = unrealizedPnL / C            (C > 0)
```

Zero cost yields an unknown return rate, not infinity or zero percent. Across the portfolio:

```text
portfolioOpenCost = Σ all open-position costs
pricedMarketValue = Σ values of effectively priced positions
pricedOpenCost = Σ costs of those same priced positions
pricedUnrealizedPnL = pricedMarketValue - pricedOpenCost
pricedAssetValue = pricedMarketValue + portfolioCash
recordedPrincipal = portfolioOpenCost + portfolioCash
pricedAssetReturn = pricedUnrealizedPnL / (pricedOpenCost + portfolioCash)
```

The asset return is unavailable when its denominator is nonpositive or no asset value exists. Missing stock prices do not become zero or cost-based valuations. Partial assets and coverage must be labelled. Estimated interest is not principal and is excluded from asset totals and P/L.

## Daily price effect and contribution

For current quantity `Q`, effective price `P`, and a reliable positive previous regular close `R`:

```text
dailyEffect = Q × (P - R)
dailyChangeRate = (P - R) / R
portfolioDailyEffect = Σ dailyEffect
portfolioDailyChangeRate = portfolioDailyEffect / Σ(Q × R)
```

Complete portfolio daily values require every open stock to have both prices. Current quantities are used even if quantities changed during the day; this is a price-effect estimate, not transaction-aware daily performance. Cash, NAV, and estimated interest do not enter daily P/L.

Structure and daily contribution have different denominators:

```text
structureDenominator = pricedStockMarketValue + portfolioCash
positionWeight_i = marketValue_i / structureDenominator
cashWeight = portfolioCash / structureDenominator
topNConcentration = Σ top N unrounded stock values / structureDenominator

absoluteDailyDenominator = Σ abs(dailyEffect_i) for calculable positions
absoluteContributionShare_i = abs(dailyEffect_i) / absoluteDailyDenominator
```

An unpriced stock has unknown weight. Missing prices produce partial structure; a nonpositive structure denominator makes weights unavailable. A calculable subset may have contribution ranks with explicit coverage, but does not produce a complete portfolio daily net. Contribution share expresses magnitude; retain signed amounts to identify positive and negative contributors. A zero absolute denominator produces unknown shares, not equal allocation or zero-percent claims.

## Intraday estimate

The trend uses real delayed SIP 15-minute bar event times and current unrounded quantities. Let `R_i` be each stock's previous regular close and `P_i(t)` its last known bar close:

```text
referenceStockValue = Σ(Q_i × R_i)
estimatedDailyPriceEffect(t) = Σ[Q_i × (P_i(t) - R_i)]
estimatedDailyChangeRate(t) = estimatedDailyPriceEffect(t) / referenceStockValue
estimatedAsset(t) = portfolioCash + Σ[Q_i × P_i(t)]
```

The timeline is the ascending union of real event times. At a time without a new bar, a stock retains its last known real close; before its first bar it uses its previous regular close. Do not interpolate prices. Missing/nonpositive reference prices, failed/missing required series, invalid trend inputs, no stocks, or insufficient drawable real points produce an unavailable chart. `NO_DATA` does not manufacture bars. Cash affects estimated assets only, not stock daily return.

The active path has no long-term range selector, NAV writer, or historical-return import. Dormant history data and code remain isolated. Do not reactivate them or clear their storage through routine maintenance. Overnight quotes must not be fabricated as SIP chart points.

## Market-data contract

An effective quote preserves instrument, provider, feed, price, price type, source event time, fetched time, market session, validation status, and a previous regular close when reliable.

| Market policy | Feed and interpretation |
|---|---|
| Pre-market, regular, after-hours | Alpaca `delayed_sip`, `LATEST_TRADE` |
| Overnight | Alpaca `overnight`, `INDICATIVE_TRADE`; never presented as SIP or an executable price |
| Closed/holiday | Last valid delayed snapshot with its actual source time |

The standard New York schedule is pre-market 04:00–09:30, regular 09:30–16:00, after-hours to 20:00, overnight 20:00–04:00. Provider calendar data handles holidays/early closes; calendar failure falls back to standard session logic rather than halting snapshots. Overnight's previous regular close is sourced from the corresponding delayed SIP daily bar, not an overnight daily bar.

The implementation uses 17/20-minute thresholds to distinguish healthy delayed, aging, and further stale/no-trade/failure states. These are application thresholds, not provider guarantees. Closed markets do not become permanent freshness alarms. Fetch outcome, session, and valuation status stay separate.

Invalid prices include nonpositive/nonfinite values, identity/currency mismatch, and future event times. Failed refreshes retain a valid cached quote and its real timestamps; a replacement must not regress event/acquisition time. Missing values never become zero or a forged fresh timestamp. Foreground refresh is approximately every minute, with a refresh on return; background execution is not promised.

Intraday bars use `sourceFeed=sip`, `timeframe=15Min`, `adjustment=split`, `priceType=MINUTE_BAR_CLOSE`, and `AT_LEAST_15_MINUTES`. `availableThrough` cannot exceed server time minus fifteen minutes. Requests contain instruments and optional `asOf`, not portfolio quantities, cost, or cash.

## USD/CNY display

USD is the input, storage, export, and copy currency:

```text
cnyDisplayAmount = unroundedUsdAmount × validUsdCnyRate
```

A display cycle uses the same rate for all amounts, then rounds at the presentation boundary. Quantities, rates of return, weights, and USD-based ordering do not change. CNY display values never replace USD source values or create FX P/L.

The provider first attempts Alpaca `USDCNY` midpoint. Its fallback uses ECB same-reference-day rates:

```text
usdCnyReferenceRate = cnyPerEurReferenceRate / usdPerEurReferenceRate
```

Use Decimal division and normalize at the FX contract boundary. The legal provider/type pairs are `alpaca/MIDPOINT` and `ecb/REFERENCE`. Preserve source and fetch times; ECB also preserves its reference day. Rates must be positive and source time must not be later than fetch time.

Client refresh is at most once per fifteen minutes. A qualified last-valid rate may be used for up to seven days with original metadata. If online sources and qualified cache are unavailable, remain in USD; do not use zero or refresh the cache timestamp artificially.

## Cash interest estimate

The legacy cash contract has `provider=IBKR`, `currency=USD`, positive balance and NAV, a Pro/Lite plan, and `USER_ENTERED` or `CASH_BALANCE_FALLBACK` NAV source. Fallback requires NAV to equal balance. Aggregate portfolio assets are never substituted for the broker's NAV.

For eligible balance `B > 0`, NAV `N`, interest-free amount `F`, full-rate NAV threshold `T`, and dated policy rate `r`:

```text
interestBearingBalance = max(B - F, 0)
navRateMultiplier = min(N / T, 1)
navAdjustedAnnualRate = r × navRateMultiplier
estimatedAnnualInterest = interestBearingBalance × navAdjustedAnnualRate
blendedAnnualRate = estimatedAnnualInterest / B
estimatedMonthlyInterest = estimatedAnnualInterest / 12
```

The checked-in policy in [domain/cash.ts](../domain/cash.ts) records its source and verification date with the rate values. Those dated values are implementation configuration, not a claim about today's broker terms. Preserve the source/date disclosure; refreshing policy terms requires separate verification. The monthly value is an estimate, not a predicted booked payment.

In broker mode, `B` is positive settled IBKR cash only. Signed total cash continues to affect assets, while pending cash, MOOMOO cash, and nonpositive IBKR balances are excluded from this interest estimate. Unbooked interest never enters principal or returns.

## JSON v2/v3 export and atomic restore

JSON v2 contains current stock snapshots and optional legacy cash. JSON v3 contains the current broker book and maintenance events. Neither is a full database, device backup, historical-return ledger, or copy of caches/drafts.

Restore requirements:

1. Validate the entire supported format/version, exact fields, decimal strings, timestamps, revisions, instruments, and normalized uniqueness. Unknown fields or an invalid item reject the whole input. A normalized symbol appearing ambiguously across markets is not silently merged.
2. Parse and preview without writes. Reject empty backups as restore operations. Explain that the target must have no stock, cash, or broker current.
3. After explicit confirmation, recheck that empty-target condition and write the normalized current in one atomic operation: a D1 state CAS for Sites, or the corresponding local transaction for the legacy repository. Two competing restores cannot both succeed.
4. Do not merge, append, or overwrite populated current. Any validation failure, conflict, cancellation, or persistence failure leaves all current state unchanged.
5. New restored records use `revision=1`, `nextRevision=2`, and `previous=null`. Source revisions are validated, not inherited. Supported v3 event contents remain part of the restored book.
6. Do not restore previous versions, original files, drafts, market/FX caches, legacy stores, outbox, cursors, or internal synchronization metadata. Revalidate cash fallback equality.

Export is read-only. A successful file-generation/share operation does not prove durable saving outside the application. Backup files are sensitive user-controlled outputs, never public fixtures.

## Synthetic reference cases

| Case | Inputs | Expected result |
|---|---|---|
| Aggregation | 10 shares with cost 1001; 5 shares with cost 602; price 130 | Quantity 15; cost 1603; average 1603/15; value 1950; P/L 347 |
| Fractional share | Quantity 0.125; average cost 200.80; price 212.40 | Cost 25.10; value 26.55; P/L 1.45 |
| CNY display | USD 1000.005; rate 7.2 | Unrounded CNY 7200.036, displayed 7200.04; never convert rounded USD |
| Daily estimate | Quantity 10; price 130; previous close 125 | Amount +50; rate +4%; missing previous close makes both unknown |
| Partial contribution | A value 600 / daily +30; B value 300 / daily −20; cash 100; C unpriced | Structure denominator 1000; A/B/cash weights 60/30/10%; C unknown; complete daily net unknown; calculable shares 60/40% |
| Source SELL | Selected source Q=10, C=1000; sell 4 at 108, fee 2 | Remaining Q=6, C=600; cash +430; all other source positions unchanged |

The cases describe arithmetic only. They do not represent a person's portfolio or verified market outcomes.
