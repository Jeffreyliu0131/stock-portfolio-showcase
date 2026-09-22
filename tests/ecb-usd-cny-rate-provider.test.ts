import { describe, expect, it, vi } from "vitest";

import {
  EcbFxRateError,
  EcbUsdCnyRateProvider,
  type EcbFxHttpFetch,
  type EcbFxHttpResponse,
} from "../application/fx/server/index.ts";

const FETCHED_AT = "2026-08-02T08:00:01Z";
const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-07-31,7.7539
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-31,1.1485
`;

function response(
  status: number,
  body = "",
): EcbFxHttpResponse {
  return {
    status,
    headers: new Headers({
      "Last-Modified": "Fri, 31 Jul 2026 13:57:02 GMT",
    }),
    async text() {
      return body;
    },
  };
}

function providerWith(fetchImpl: EcbFxHttpFetch) {
  return new EcbUsdCnyRateProvider({
    fetchImpl,
    now: () => FETCHED_AT,
  });
}

describe("server-only ECB USD/CNY reference-rate adapter", () => {
  it("derives the exact USD/CNY cross rate from same-day EUR reference rates", async () => {
    const fetchImpl = vi.fn<EcbFxHttpFetch>(async () =>
      response(200, ECB_CSV),
    );

    await expect(
      providerWith(fetchImpl).getLatestRate(),
    ).resolves.toEqual({
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "6.75132782",
      provider: "ecb",
      rateType: "REFERENCE",
      referenceDate: "2026-07-31",
      sourceEventAt: "2026-07-31T13:57:02.000Z",
      fetchedAt: FETCHED_AT,
    });

    const call = fetchImpl.mock.calls[0];
    if (call === undefined) {
      throw new Error("missing ECB exchange-rate request");
    }
    const [rawUrl, init] = call;
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY.EUR.SP00.A",
    );
    expect(url.searchParams.get("lastNObservations")).toBe("1");
    expect(url.searchParams.get("format")).toBe("csvdata");
    expect(url.searchParams.get("detail")).toBe("dataonly");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "text/csv" },
    });
    expect(JSON.stringify(init.headers)).not.toContain("APCA-API");
  });

  it.each([
    [429, "RATE_LIMITED"],
    [500, "UNAVAILABLE"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const text = vi.fn(async () => {
      throw new Error("error body must not be parsed");
    });
    const provider = providerWith(async () => ({
      status,
      headers: new Headers(),
      text,
    }));

    await expect(provider.getLatestRate()).rejects.toMatchObject({
      name: "EcbFxRateError",
      code,
    });
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing CNY observation",
      `KEY,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nkey,USD,EUR,2026-07-31,1.1485`,
    ],
    [
      "mismatched dates",
      `KEY,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nkey,CNY,EUR,2026-07-30,7.7539\nkey,USD,EUR,2026-07-31,1.1485`,
    ],
    [
      "non-positive observation",
      `KEY,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nkey,CNY,EUR,2026-07-31,0\nkey,USD,EUR,2026-07-31,1.1485`,
    ],
    [
      "unterminated CSV quote",
      `KEY,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nkey,CNY,EUR,2026-07-31,"7.7539`,
    ],
    ["oversized response", "x".repeat(64_001)],
  ])("rejects %s", async (_name, body) => {
    await expect(
      providerWith(async () => response(200, body)).getLatestRate(),
    ).rejects.toMatchObject({
      name: "EcbFxRateError",
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects a response without an official update time", async () => {
    await expect(
      providerWith(async () => ({
        status: 200,
        headers: new Headers(),
        async text() {
          return ECB_CSV;
        },
      })).getLatestRate(),
    ).rejects.toMatchObject({
      name: "EcbFxRateError",
      code: "INVALID_RESPONSE",
    });
  });

  it("aborts at the configured timeout", async () => {
    const fetchImpl: EcbFxHttpFetch = async (_url, init) =>
      new Promise<EcbFxHttpResponse>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    const provider = new EcbUsdCnyRateProvider({
      fetchImpl,
      now: () => FETCHED_AT,
      timeoutMs: 1,
    });

    await expect(provider.getLatestRate()).rejects.toBeInstanceOf(
      EcbFxRateError,
    );
  });
});
