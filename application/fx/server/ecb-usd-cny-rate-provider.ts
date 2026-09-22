import {
  canonicalDecimal,
  parsePositiveInput,
} from "../../../domain/index.ts";
import {
  ECB_USD_CNY_RATE_PROVIDER,
  ECB_USD_CNY_RATE_TYPE,
  normalizeUsdCnyRate,
  type UsdCnyRate,
} from "../types.ts";
import { logSitesUpstreamFailure } from "../../runtime/sites-diagnostics.ts";

const ECB_EXCHANGE_RATES_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY.EUR.SP00.A";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_CHARACTERS = 64_000;
const RATE_SCALE = 8;

export interface EcbFxHttpResponse {
  readonly status: number;
  readonly headers: Pick<Headers, "get">;
  text(): Promise<string>;
}

export type EcbFxHttpFetch = (
  input: string,
  init: RequestInit,
) => Promise<EcbFxHttpResponse>;

export type EcbFxRateErrorCode =
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class EcbFxRateError extends Error {
  readonly code: EcbFxRateErrorCode;

  constructor(code: EcbFxRateErrorCode, message: string) {
    super(message);
    this.name = "EcbFxRateError";
    this.code = code;
  }
}

export interface EcbUsdCnyRateProviderOptions {
  readonly fetchImpl?: EcbFxHttpFetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "EcbUsdCnyRateProvider can only run in a server runtime",
    );
  }
}

function validatedTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
    );
  }
  return value;
}

function errorForStatus(status: number): EcbFxRateError | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 429) {
    return new EcbFxRateError(
      "RATE_LIMITED",
      "ECB exchange-rate request was rate limited",
    );
  }
  return new EcbFxRateError(
    "UNAVAILABLE",
    "ECB exchange-rate service is unavailable",
  );
}

function defaultFetch(
  input: string,
  init: RequestInit,
): Promise<EcbFxHttpResponse> {
  return globalThis.fetch(input, init);
}

function invalidResponse(message: string): never {
  throw new EcbFxRateError("INVALID_RESPONSE", message);
}

function parseCsvRows(value: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) {
        invalidResponse("ECB CSV contains an invalid quoted field");
      }
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      if (row.some((item) => item.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) {
    invalidResponse("ECB CSV contains an unterminated quoted field");
  }
  row.push(field);
  if (row.some((item) => item.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function requireColumn(
  columns: ReadonlyMap<string, number>,
  name: string,
): number {
  const index = columns.get(name);
  if (index === undefined) {
    invalidResponse(`ECB CSV is missing ${name}`);
  }
  return index;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function sourceEventAtFrom(
  response: EcbFxHttpResponse,
): string {
  const lastModified = response.headers.get("last-modified");
  if (lastModified === null) {
    invalidResponse("ECB response has no Last-Modified time");
  }
  const parsed = new Date(lastModified);
  if (Number.isNaN(parsed.getTime())) {
    invalidResponse("ECB response has an invalid Last-Modified time");
  }
  return parsed.toISOString();
}

function mapRate(
  body: string,
  sourceEventAt: string,
  fetchedAt: string,
): UsdCnyRate {
  if (body.length > MAX_RESPONSE_CHARACTERS) {
    invalidResponse("ECB CSV exceeds the response size limit");
  }
  const rows = parseCsvRows(body);
  const header = rows[0];
  if (header === undefined) {
    invalidResponse("ECB CSV is empty");
  }
  const columns = new Map(
    header.map((name, index) => [name.replace(/^\uFEFF/, ""), index]),
  );
  const currencyIndex = requireColumn(columns, "CURRENCY");
  const denominatorIndex = requireColumn(columns, "CURRENCY_DENOM");
  const periodIndex = requireColumn(columns, "TIME_PERIOD");
  const valueIndex = requireColumn(columns, "OBS_VALUE");
  const rates = new Map<"USD" | "CNY", { period: string; value: string }>();

  for (const row of rows.slice(1)) {
    const currency = row[currencyIndex];
    if (currency !== "USD" && currency !== "CNY") {
      continue;
    }
    if (row[denominatorIndex] !== "EUR") {
      invalidResponse("ECB CSV contains an unexpected denominator");
    }
    const period = row[periodIndex];
    const observation = row[valueIndex];
    if (
      period === undefined ||
      observation === undefined ||
      !isCalendarDate(period)
    ) {
      invalidResponse("ECB CSV contains an invalid observation");
    }
    rates.set(currency, { period, value: observation });
  }

  const usdPerEur = rates.get("USD");
  const cnyPerEur = rates.get("CNY");
  if (usdPerEur === undefined || cnyPerEur === undefined) {
    invalidResponse("ECB CSV does not contain both USD and CNY rates");
  }
  if (usdPerEur.period !== cnyPerEur.period) {
    invalidResponse("ECB USD and CNY observations have different dates");
  }

  const usd = parsePositiveInput(usdPerEur.value, "ecbUsdPerEur");
  const cny = parsePositiveInput(cnyPerEur.value, "ecbCnyPerEur");
  const crossRate = canonicalDecimal(
    cny.div(usd).toDecimalPlaces(RATE_SCALE),
  );
  const normalized = normalizeUsdCnyRate({
    baseCurrency: "USD",
    quoteCurrency: "CNY",
    rate: crossRate,
    provider: ECB_USD_CNY_RATE_PROVIDER,
    rateType: ECB_USD_CNY_RATE_TYPE,
    referenceDate: usdPerEur.period,
    sourceEventAt,
    fetchedAt,
  });
  if (normalized === null) {
    invalidResponse("ECB cross rate is invalid");
  }
  return normalized;
}

export class EcbUsdCnyRateProvider {
  private readonly fetchImpl: EcbFxHttpFetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(options: EcbUsdCnyRateProviderOptions = {}) {
    assertServerRuntime();
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = validatedTimeout(options.timeoutMs);
  }

  async getLatestRate(): Promise<UsdCnyRate> {
    const url = new URL(ECB_EXCHANGE_RATES_URL);
    url.searchParams.set("lastNObservations", "1");
    url.searchParams.set("format", "csvdata");
    url.searchParams.set("detail", "dataonly");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "text/csv" },
        signal: controller.signal,
      });
      const statusError = errorForStatus(response.status);
      if (statusError !== null) {
        logSitesUpstreamFailure("ecb_fx", response.status);
        throw statusError;
      }
      const body = await response.text();
      try {
        const fetchedAt = this.now();
        return mapRate(
          body,
          sourceEventAtFrom(response),
          fetchedAt,
        );
      } catch (error) {
        if (error instanceof EcbFxRateError) {
          throw error;
        }
        throw new EcbFxRateError(
          "INVALID_RESPONSE",
          "ECB exchange-rate response is invalid",
        );
      }
    } catch (error) {
      if (error instanceof EcbFxRateError) {
        throw error;
      }
      logSitesUpstreamFailure("ecb_fx", error);
      throw new EcbFxRateError(
        "UNAVAILABLE",
        "ECB exchange-rate request failed",
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
