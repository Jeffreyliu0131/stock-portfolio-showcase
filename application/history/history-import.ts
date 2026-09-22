import {
  Decimal,
  canonicalDecimal,
  compareRfc3339,
  parseDecimal,
  type DecimalString,
} from "../../domain/index.ts";
import { extractPdfTextLocally, type ExtractedPdfText } from "./browser/pdf-text.ts";
import type {
  HistoryAssetClass,
  HistoryBroker,
  HistoryImportCandidate,
  HistoryImportDocument,
  HistoryImportIssue,
  HistoryNavSnapshotEvent,
  HistoryTradeEvent,
  PortfolioHistoryEvent,
} from "./types.ts";

const MAX_FILE_COUNT = 24;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export interface LocalHistoryImportFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ParseHistoryImportOptions {
  readonly now?: () => string;
  readonly extractPdf?: (bytes: ArrayBuffer) => Promise<ExtractedPdfText>;
}

interface ParsedDocument {
  readonly broker: "IBKR" | "MOOMOO";
  readonly events: readonly PortfolioHistoryEvent[];
  readonly issues: readonly HistoryImportIssue[];
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

interface CsvSection {
  readonly headers: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

function textDecoder(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
}

async function sha256(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function scopeHash(broker: string, account: string): Promise<string> {
  return await sha256(`portfolio-history-scope-v1\u0000${broker}\u0000${account.trim()}`);
}

async function stableId(prefix: string, value: string): Promise<string> {
  const digest = await sha256(`portfolio-history-event-v1\u0000${value}`);
  return `${prefix}:${digest}`;
}

function plainDecimal(value: string): DecimalString {
  const normalized = value
    .trim()
    .replace(/[$¥￥]/g, "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/^\+/, "");
  return canonicalDecimal(
    parseDecimal(normalized, { field: "historyImport.amount", maxFractionalDigits: 8 }),
  );
}

function absoluteDecimal(value: string): DecimalString {
  return canonicalDecimal(new Decimal(plainDecimal(value)).abs());
}

function dateTimestamp(value: string): string {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (compact !== null) {
    return `${compact[1]}-${compact[2]}-${compact[3]}T21:00:00Z`;
  }
  const date = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(value.trim());
  if (date !== null) {
    return `${date[1]}-${date[2]}-${date[3]}T21:00:00Z`;
  }
  throw new Error(`unsupported statement date: ${value}`);
}

function tradeTimestamp(value: string): string {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})(?:[, T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value.trim(),
  );
  if (match === null) {
    throw new Error(`unsupported trade timestamp: ${value}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "21"}:${match[5] ?? "00"}:${match[6] ?? "00"}Z`;
}

function detectAccount(text: string, broker: "IBKR" | "MOOMOO"): string | null {
  const patterns = broker === "IBKR"
    ? [
        /(?:Account(?:\s+Number)?|账户号码)\s*[:,]?\s*([A-Z]\d{5,20})/i,
        /\b(U\d{5,20})\b/i,
      ]
    : [
        /Account\s+Number\s*:\s*([A-Z0-9-]{6,30})/i,
        /账户号码\s*[:：]?\s*([A-Z0-9-]{6,30})/i,
      ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

function detectBroker(text: string): "IBKR" | "MOOMOO" | null {
  if (
    /Interactive\s+Brokers|Activity\s+Statement|Trade\s+Confirmation\s+Report|交易确认报告/i.test(text)
  ) {
    return "IBKR";
  }
  if (
    /Monthly\s+Statement\s+of\s+(?:Margin|Cash)\s+Account|Changes\s+in\s+Net\s+Asset\s+Value|Preparation\s+Date|moomoo/i.test(text)
  ) {
    return "MOOMOO";
  }
  return null;
}

function isCurrentPortfolioSnapshot(text: string): boolean {
  return (
    /持仓资料\s*[（(]USD[）)]/i.test(text) &&
    /【组合】/.test(text) &&
    /【持仓(?:（按市值降序）)?】/.test(text)
  );
}

function csvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function normalizedHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_./()\-]+/g, "");
}

function valueFrom(
  record: ReadonlyMap<string, string>,
  ...names: readonly string[]
): string | null {
  for (const name of names) {
    const value = record.get(normalizedHeader(name));
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function recordFrom(headers: readonly string[], values: readonly string[]): ReadonlyMap<string, string> {
  return new Map(headers.map((header, index) => [normalizedHeader(header), values[index] ?? ""]));
}

function optionDetails(symbol: string): HistoryTradeEvent["option"] | undefined {
  const spaced = /^([A-Z.]+)\s+(\d{1,2})([A-Z]{3})(\d{2})\s+(\d+(?:\.\d+)?)\s+([CP])$/i.exec(
    symbol.trim(),
  );
  if (spaced === null) {
    return undefined;
  }
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const month = months[spaced[3]?.toUpperCase() ?? ""];
  if (month === undefined) {
    return undefined;
  }
  return {
    expiration: `20${spaced[4]}-${month}-${spaced[2]?.padStart(2, "0")}`,
    strike: plainDecimal(spaced[5] ?? "0"),
    right: spaced[6]?.toUpperCase() === "C" ? "CALL" : "PUT",
  };
}

function underlyingSymbol(value: string): string {
  return value.trim().toUpperCase().split(/\s+/)[0] ?? value.trim().toUpperCase();
}

async function tradeEvent(
  broker: "IBKR" | "MOOMOO",
  scope: string,
  record: ReadonlyMap<string, string>,
  recordedAt: string,
): Promise<HistoryTradeEvent | null> {
  const sideRaw = valueFrom(record, "Buy/Sell", "Type", "Action", "类型", "买卖");
  const symbolRaw = valueFrom(record, "Symbol", "Description", "代码", "Contract Description");
  const quantityRaw = valueFrom(record, "Quantity", "Qty", "数量");
  const priceRaw = valueFrom(record, "T. Price", "TradePrice", "Price", "价格");
  const dateRaw = valueFrom(record, "Date/Time", "TradeDateTime", "交易日期/时间", "Trade Date");
  if (
    sideRaw === null ||
    symbolRaw === null ||
    quantityRaw === null ||
    priceRaw === null ||
    dateRaw === null
  ) {
    return null;
  }
  const sideToken = sideRaw.toUpperCase();
  const side = sideToken.includes("BUY") || sideToken.includes("买")
    ? "BUY"
    : sideToken.includes("SELL") || sideToken.includes("卖")
      ? "SELL"
      : null;
  if (side === null) {
    return null;
  }
  const occurredAt = tradeTimestamp(dateRaw);
  const option = optionDetails(symbolRaw.toUpperCase());
  const assetClassRaw = valueFrom(record, "Asset Category", "AssetClass", "资产类别") ?? "";
  const assetClass: HistoryAssetClass = option !== undefined || /option|期权/i.test(assetClassRaw)
    ? "OPTION"
    : /fund|etf/i.test(assetClassRaw)
      ? "ETF"
      : "STOCK";
  const externalRaw = valueFrom(
    record,
    "TradeID",
    "TransactionID",
    "ExecID",
    "Execution ID",
  );
  const externalId = externalRaw?.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  const quantity = absoluteDecimal(quantityRaw);
  const price = absoluteDecimal(priceRaw);
  const feesRaw = valueFrom(record, "Comm/Fee", "Commission", "佣金", "Fees") ?? "0";
  const fees = absoluteDecimal(feesRaw);
  const canonical = [
    broker,
    scope,
    occurredAt,
    symbolRaw.toUpperCase().replace(/\s+/g, " "),
    side,
    quantity,
    price,
    externalId ?? "",
  ].join("|");
  return {
    id: await stableId("trade", canonical),
    type: "TRADE",
    source: broker,
    sourceScopeHash: scope,
    occurredAt,
    recordedAt,
    assetClass,
    side,
    symbol: underlyingSymbol(symbolRaw),
    quantity,
    price,
    multiplier: assetClass === "OPTION" ? "100" : "1",
    feesUsd: fees,
    currency: "USD",
    ...(externalId === undefined || externalId.length === 0 ? {} : { externalId }),
    ...(option === undefined ? {} : { option }),
  };
}

async function ibkrTextTradeEvents(
  text: string,
  scope: string,
  recordedAt: string,
): Promise<readonly HistoryTradeEvent[]> {
  const events: HistoryTradeEvent[] = [];
  const pattern = /^\s*(U\d{5,20})\s+(.+?)\s+(\d{4}-\d{2}-\d{2})(?:,\s*(\d{2}:\d{2}:\d{2}))?\s+\d{4}-\d{2}-\d{2}\s+(?:-|--|[A-Z0-9]+)\s+(BUY|SELL)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s+([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/gim;
  for (const match of text.matchAll(pattern)) {
    const symbolRaw = match[2];
    const tradeDate = match[3];
    const side = match[5];
    const quantity = match[6];
    const price = match[7];
    if (
      symbolRaw === undefined ||
      tradeDate === undefined ||
      side === undefined ||
      quantity === undefined ||
      price === undefined
    ) {
      continue;
    }
    const record = new Map<string, string>([
      [normalizedHeader("Symbol"), symbolRaw],
      [normalizedHeader("Date/Time"), `${tradeDate}${match[4] === undefined ? "" : ` ${match[4]}`}`],
      [normalizedHeader("Type"), side],
      [normalizedHeader("Quantity"), quantity],
      [normalizedHeader("Price"), price],
      [normalizedHeader("Commission"), match[8] ?? "0"],
      [
        normalizedHeader("Asset Category"),
        optionDetails(symbolRaw.toUpperCase()) === undefined ? "Stocks" : "Options",
      ],
    ]);
    const event = await tradeEvent("IBKR", scope, record, recordedAt);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}

async function navEvent(
  broker: "IBKR" | "MOOMOO",
  scope: string,
  date: string,
  valueUsdRaw: string,
  recordedAt: string,
  coverage: HistoryNavSnapshotEvent["coverage"] = "COMPLETE",
): Promise<HistoryNavSnapshotEvent> {
  const occurredAt = dateTimestamp(date);
  const valueUsd = absoluteDecimal(valueUsdRaw);
  return {
    id: await stableId("nav", `${broker}|${scope}|${occurredAt}`),
    type: "NAV_SNAPSHOT",
    source: broker,
    sourceScopeHash: scope,
    occurredAt,
    recordedAt,
    scopeKind: "ACCOUNT",
    valueUsd,
    sourceCurrency: "USD",
    sourceValue: valueUsd,
    fxRateToUsd: "1",
    coverage,
  };
}

function dateBounds(events: readonly PortfolioHistoryEvent[]): {
  readonly start: string | null;
  readonly end: string | null;
} {
  const sorted = events
    .map((event) => event.occurredAt)
    .toSorted(compareRfc3339);
  return { start: sorted[0] ?? null, end: sorted.at(-1) ?? null };
}

async function parseMoomoo(
  text: string,
  scope: string,
  recordedAt: string,
): Promise<ParsedDocument> {
  const events: PortfolioHistoryEvent[] = [];
  const issues: HistoryImportIssue[] = [];
  const navCoverage = /Portfolio\s+Coverage\s*:\s*PARTIAL/i.test(text)
    ? "PARTIAL"
    : "COMPLETE";
  const navPattern = /(Starting|Ending)\s+Net\s+Asset\s+Value\s+(\d{8})[\s\S]{0,260}?Equal\s+to\s*\(USD\)\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of text.matchAll(navPattern)) {
    if (match[2] !== undefined && match[3] !== undefined) {
      events.push(
        await navEvent(
          "MOOMOO",
          scope,
          match[2],
          match[3],
          recordedAt,
          navCoverage,
        ),
      );
    }
  }

  const cashSections = text.match(/Changes\s+in\s+Cash[\s\S]*?(?=Changes\s+in\s+(?:Position|Assets)|Asset\s+Value:|\f|$)/gi) ?? [];
  const internalCashLabels = /^(?:buy amount|sell amount|buy fee|sell fee|coupon|cash plus|cash dividend|foreign tax withholding|nra withholding tax|withholding tax|commission|fee|interest|margin interest|total)$/i;
  const externalDeposit = /^(?:deposit|cash deposit|funds deposit|wire deposit|入金)$/i;
  const externalWithdrawal = /^(?:withdrawal|cash withdrawal|funds withdrawal|wire withdrawal|出金)$/i;
  for (const section of cashSections) {
    const linePattern = /^\s*([A-Za-z][A-Za-z /&+.-]*?|[\u4e00-\u9fff]+)\s*([+-](?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+/gm;
    for (const line of section.matchAll(linePattern)) {
      const label = line[1]?.trim() ?? "";
      const amountRaw = line[2] ?? "0";
      if (internalCashLabels.test(label)) {
        continue;
      }
      const direction = externalDeposit.test(label)
        ? "DEPOSIT"
        : externalWithdrawal.test(label)
          ? "WITHDRAWAL"
          : null;
      if (direction === null) {
        issues.push({
          severity: "BLOCKING",
          code: "UNKNOWN_CASH_CLASSIFICATION",
          message: `发现无法确定是否属于外部入出金的现金项目：${label}`,
        });
        continue;
      }
      const statementDate = /Ending\s+Net\s+Asset\s+Value\s+(\d{8})/i.exec(text)?.[1];
      if (statementDate === undefined) {
        issues.push({
          severity: "BLOCKING",
          code: "INCOMPLETE_DOCUMENT",
          message: "现金项目缺少可确认的月结结束日期。",
        });
        continue;
      }
      const amount = new Decimal(plainDecimal(amountRaw)).abs();
      const signed = direction === "DEPOSIT" ? amount : amount.neg();
      const occurredAt = dateTimestamp(statementDate);
      events.push({
        id: await stableId("flow", `MOOMOO|${scope}|${occurredAt}|${direction}|${signed.toString()}`),
        type: "EXTERNAL_FLOW",
        source: "MOOMOO",
        sourceScopeHash: scope,
        occurredAt,
        recordedAt,
        amountUsd: canonicalDecimal(signed),
        direction,
        classification:
          direction === "DEPOSIT" ? "EXTERNAL_DEPOSIT" : "EXTERNAL_WITHDRAWAL",
      });
    }
  }

  const rows = csvRows(text);
  if (rows.length > 1) {
    const headers = rows[0] ?? [];
    for (const row of rows.slice(1)) {
      const event = await tradeEvent("MOOMOO", scope, recordFrom(headers, row), recordedAt);
      if (event !== null) {
        events.push(event);
      }
    }
  }
  if (!events.some((event) => event.type === "NAV_SNAPSHOT")) {
    issues.push({
      severity: events.length === 0 ? "BLOCKING" : "WARNING",
      code: "MISSING_NAV",
      message: "这份 moomoo 文件没有识别到起止 NAV；交易可留作审计，但不能单独生成长期收益。",
    });
  }
  const unique = deduplicateEvents(events, issues);
  const bounds = dateBounds(unique);
  return { broker: "MOOMOO", events: unique, issues, periodStart: bounds.start, periodEnd: bounds.end };
}

async function parseIbkr(
  text: string,
  scope: string,
  recordedAt: string,
): Promise<ParsedDocument> {
  const events: PortfolioHistoryEvent[] = [];
  const issues: HistoryImportIssue[] = [];
  const rows = csvRows(text);
  const sections = new Map<string, CsvSection>();

  for (const row of rows) {
    const sectionName = row[0]?.trim() ?? "";
    const rowType = row[1]?.trim().toLowerCase() ?? "";
    if (rowType === "header") {
      sections.set(sectionName, { headers: row.slice(2) });
      continue;
    }
    if (rowType !== "data") {
      continue;
    }
    const section = sections.get(sectionName);
    if (section === undefined) {
      continue;
    }
    const record = recordFrom(section.headers, row.slice(2));
    if (/trade/i.test(sectionName)) {
      const level = valueFrom(record, "LevelOfDetail", "DataDiscriminator", "Detail") ?? "";
      if (/summary|subtotal|total/i.test(level)) {
        continue;
      }
      const event = await tradeEvent("IBKR", scope, record, recordedAt);
      if (event !== null) {
        events.push(event);
      }
    }
    if (/net asset value/i.test(sectionName)) {
      const category = valueFrom(record, "Asset Class", "AssetCategory", "Type") ?? "";
      if (!/total|base currency summary/i.test(category)) {
        continue;
      }
      const prior = valueFrom(record, "Prior Total", "Starting Value", "Beginning Value");
      const current = valueFrom(record, "Current Total", "Ending Value", "Total");
      const period = statementPeriod(text);
      if (prior !== null && period.start !== null) {
        events.push(await navEvent("IBKR", scope, period.start, prior, recordedAt));
      }
      if (current !== null && period.end !== null) {
        events.push(await navEvent("IBKR", scope, period.end, current, recordedAt));
      }
    }
    if (/deposit.*withdraw|cash transaction/i.test(sectionName)) {
      const description = valueFrom(record, "Description", "Activity Description", "Type") ?? "";
      const amountRaw = valueFrom(record, "Amount", "NetAmount", "Proceeds");
      const dateRaw = valueFrom(record, "Settle Date", "Date", "Report Date");
      if (amountRaw === null || dateRaw === null) {
        continue;
      }
      const isDeposit = /deposit|wire received|electronic fund transfer received/i.test(description);
      const isWithdrawal = /withdraw|wire sent|electronic fund transfer sent/i.test(description);
      if (!isDeposit && !isWithdrawal) {
        issues.push({
          severity: "BLOCKING",
          code: "UNKNOWN_CASH_CLASSIFICATION",
          message: `发现无法确定是否属于外部入出金的 IBKR 现金项目：${description || "未命名"}`,
        });
        continue;
      }
      const direction = isDeposit ? "DEPOSIT" : "WITHDRAWAL";
      const amount = new Decimal(plainDecimal(amountRaw)).abs();
      const signed = direction === "DEPOSIT" ? amount : amount.neg();
      const occurredAt = dateTimestamp(dateRaw.replace(/-/g, ""));
      events.push({
        id: await stableId("flow", `IBKR|${scope}|${occurredAt}|${direction}|${signed.toString()}`),
        type: "EXTERNAL_FLOW",
        source: "IBKR",
        sourceScopeHash: scope,
        occurredAt,
        recordedAt,
        amountUsd: canonicalDecimal(signed),
        direction,
        classification:
          direction === "DEPOSIT" ? "EXTERNAL_DEPOSIT" : "EXTERNAL_WITHDRAWAL",
      });
    }
  }

  if (rows.length > 1 && !rows.some((row) => row[1]?.toLowerCase() === "data")) {
    const headers = rows[0] ?? [];
    for (const row of rows.slice(1)) {
      const event = await tradeEvent("IBKR", scope, recordFrom(headers, row), recordedAt);
      if (event !== null) {
        events.push(event);
      }
    }
  }

  events.push(...(await ibkrTextTradeEvents(text, scope, recordedAt)));

  const genericNav = /(Starting|Ending)\s+Net\s+Asset\s+Value\s+(\d{8})[\s\S]{0,220}?(?:Equal\s+to\s*\(USD\)|USD)\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of text.matchAll(genericNav)) {
    if (match[2] !== undefined && match[3] !== undefined) {
      events.push(await navEvent("IBKR", scope, match[2], match[3], recordedAt));
    }
  }

  const period = statementPeriod(text);
  const activityNav = /(?:Change\s+in\s+NAV|Net\s+Asset\s+Value)[\s\S]{0,3000}?Starting\s+Value\s+([\d,]+(?:\.\d+)?)[\s\S]{0,3000}?Ending\s+Value\s+([\d,]+(?:\.\d+)?)/i.exec(
    text,
  );
  if (
    activityNav?.[1] !== undefined &&
    activityNav[2] !== undefined &&
    period.start !== null &&
    period.end !== null
  ) {
    events.push(await navEvent("IBKR", scope, period.start, activityNav[1], recordedAt));
    events.push(await navEvent("IBKR", scope, period.end, activityNav[2], recordedAt));
  }

  if (!events.some((event) => event.type === "NAV_SNAPSHOT")) {
    issues.push({
      severity: events.length === 0 ? "BLOCKING" : "WARNING",
      code: "MISSING_NAV",
      message: "这份 IBKR 文件没有识别到 NAV；交易确认只能用于审计，需 Activity/Monthly Statement 才能生成长期收益。",
    });
  }
  const unique = deduplicateEvents(events, issues);
  const bounds = dateBounds(unique);
  return { broker: "IBKR", events: unique, issues, periodStart: bounds.start, periodEnd: bounds.end };
}

function statementPeriod(text: string): { start: string | null; end: string | null } {
  const period = /Period\s*[:,]?\s*(\d{4}-?\d{2}-?\d{2})\s*(?:-|to)\s*(\d{4}-?\d{2}-?\d{2})/i.exec(text);
  if (period?.[1] !== undefined && period[2] !== undefined) {
    return { start: period[1].replace(/-/g, ""), end: period[2].replace(/-/g, "") };
  }
  const english = /(?:Period\s*[:,]?\s*)?([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*(?:-|to)\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(
    text,
  );
  if (english?.[1] === undefined || english[2] === undefined) {
    return { start: null, end: null };
  }
  const compact = (value: string): string | null => {
    const date = new Date(`${value} 00:00:00 UTC`);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10).replace(/-/g, "");
  };
  return { start: compact(english[1]), end: compact(english[2]) };
}

function deduplicateEvents(
  events: readonly PortfolioHistoryEvent[],
  issues: HistoryImportIssue[],
): readonly PortfolioHistoryEvent[] {
  const byId = new Map<string, PortfolioHistoryEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (existing === undefined) {
      byId.set(event.id, event);
    } else if (JSON.stringify(existing) !== JSON.stringify(event)) {
      issues.push({
        severity: "BLOCKING",
        code: "CONFLICTING_EVENT",
        message: "同一来源事件在文件内出现冲突值。",
      });
    }
  }
  return [...byId.values()].toSorted((left, right) =>
    compareRfc3339(left.occurredAt, right.occurredAt),
  );
}

function formatFromName(name: string, mime: string): "CSV" | "PDF_TEXT" | "TEXT" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    return "PDF_TEXT";
  }
  if (lower.endsWith(".csv") || /csv/i.test(mime)) {
    return "CSV";
  }
  if (lower.endsWith(".txt") || mime.startsWith("text/")) {
    return "TEXT";
  }
  return null;
}

async function parseOne(
  file: LocalHistoryImportFile,
  options: Required<ParseHistoryImportOptions>,
): Promise<HistoryImportCandidate> {
  const format = formatFromName(file.name, file.type);
  const bytes = await file.arrayBuffer();
  const fileSha256 = await sha256(bytes);
  if (!SHA256.test(fileSha256) || format === null) {
    return blockedCandidate(fileSha256, options.now(), "UNSUPPORTED_FILE", "只支持 CSV、文本层 PDF 或 TXT。", format ?? "TEXT");
  }
  let text: string;
  let pageCount: number | null = null;
  const extractionIssues: HistoryImportIssue[] = [];
  if (format === "PDF_TEXT") {
    const extracted = await options.extractPdf(bytes);
    text = extracted.text;
    pageCount = extracted.pageCount;
    if (extracted.textPageCount < extracted.pageCount) {
      extractionIssues.push({
        severity: "BLOCKING",
        code: "SCANNED_PDF",
        message: "PDF 至少有一页没有可读取文本；请改用文本层 PDF 或 CSV，不进行 OCR 猜测。",
      });
    }
  } else {
    text = textDecoder(bytes);
  }
  const broker = detectBroker(text);
  if (broker === null) {
    if (isCurrentPortfolioSnapshot(text)) {
      return blockedCandidate(
        fileSha256,
        options.now(),
        "CURRENT_SNAPSHOT_ONLY",
        "这份是当前持仓摘要，只能支持当前估值与 1D；它没有历史 NAV，不能生成 1W、1M、3M、1Y 或 ALL。请粘贴 moomoo Monthly Statement 或 IBKR Activity Statement 中含 Starting/Ending NAV 的原文。",
        format,
        pageCount,
      );
    }
    return blockedCandidate(fileSha256, options.now(), "UNKNOWN_BROKER", "无法确认文件来自 IBKR 或 moomoo。", format, pageCount);
  }
  const account = detectAccount(text, broker);
  if (account === null) {
    return blockedCandidate(fileSha256, options.now(), "INCOMPLETE_DOCUMENT", "文件缺少可用于跨月去重的账户标识；不会保存原号码，但导入前必须能在本机识别。", format, pageCount, broker);
  }
  const scope = await scopeHash(broker, account);
  const parsed = broker === "IBKR"
    ? await parseIbkr(text, scope, options.now())
    : await parseMoomoo(text, scope, options.now());
  const document: HistoryImportDocument = {
    importId: fileSha256,
    fileSha256,
    broker: parsed.broker,
    detectedFormat: format,
    pageCount,
    importedAt: options.now(),
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    eventCount: parsed.events.length,
  };
  const issues = [...extractionIssues, ...parsed.issues];
  if (parsed.events.length === 0) {
    issues.push({
      severity: "BLOCKING",
      code: "NO_IMPORTABLE_RECORDS",
      message: "没有识别到可导入的 NAV、外部现金流或交易。",
    });
  }
  return { document, events: parsed.events, issues };
}

function blockedCandidate(
  hash: string,
  now: string,
  code: HistoryImportIssue["code"],
  message: string,
  format: HistoryImportDocument["detectedFormat"],
  pageCount: number | null = null,
  broker: "IBKR" | "MOOMOO" = "IBKR",
): HistoryImportCandidate {
  return {
    document: {
      importId: hash,
      fileSha256: hash,
      broker,
      detectedFormat: format,
      pageCount,
      importedAt: now,
      periodStart: null,
      periodEnd: null,
      eventCount: 0,
    },
    events: [],
    issues: [{ severity: "BLOCKING", code, message }],
  };
}

export async function parseHistoryImportFiles(
  files: readonly LocalHistoryImportFile[],
  options: ParseHistoryImportOptions = {},
): Promise<readonly HistoryImportCandidate[]> {
  const now = options.now ?? (() => new Date().toISOString());
  const extractPdf = options.extractPdf ?? extractPdfTextLocally;
  if (files.length === 0 || files.length > MAX_FILE_COUNT) {
    const digest = await sha256(`invalid-file-count:${files.length}`);
    return [
      blockedCandidate(
        digest,
        now(),
        "FILE_LIMIT_EXCEEDED",
        `一次请选择 1–${MAX_FILE_COUNT} 个文件。`,
        "TEXT",
      ),
    ];
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES || files.some((file) => file.size > MAX_FILE_BYTES)) {
    const digest = await sha256(`invalid-file-size:${total}`);
    return [
      blockedCandidate(
        digest,
        now(),
        "FILE_LIMIT_EXCEEDED",
        "单个文件不得超过 16 MB，一批总计不得超过 80 MB。",
        "TEXT",
      ),
    ];
  }
  const candidates: HistoryImportCandidate[] = [];
  for (const file of files) {
    try {
      candidates.push(await parseOne(file, { now, extractPdf }));
    } catch {
      const bytes = await file.arrayBuffer();
      const digest = await sha256(bytes);
      candidates.push(
        blockedCandidate(
          digest,
          now(),
          "UNKNOWN_LAYOUT",
          "文件结构无法可靠识别；未写入任何历史数据。",
          formatFromName(file.name, file.type) ?? "TEXT",
        ),
      );
    }
  }
  return candidates;
}

export async function parseHistoryImportText(
  text: string,
  options: ParseHistoryImportOptions = {},
): Promise<HistoryImportCandidate> {
  const bytes = new TextEncoder().encode(text);
  const [candidate] = await parseHistoryImportFiles(
    [
      {
        name: "pasted-statement.txt",
        type: "text/plain",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.slice().buffer,
      },
    ],
    options,
  );
  if (candidate === undefined) {
    throw new Error("pasted history text did not produce an import candidate");
  }
  return candidate;
}

export async function privateHistoryScopeHash(
  broker: Exclude<HistoryBroker, "MANUAL" | "LOCAL">,
  accountIdentifier: string,
): Promise<string> {
  return await scopeHash(broker, accountIdentifier);
}
