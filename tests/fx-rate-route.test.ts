import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/fx/usd-cny/route.ts";
import { resetFxRouteSecurityForTests } from "../application/fx/server/usd-cny-route-cache.ts";

const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-07-31,7.7539
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-31,1.1485
`;
const ECB_HEADERS = {
  "Last-Modified": "Fri, 31 Jul 2026 13:57:02 GMT",
};

function request(headers: Readonly<Record<string, string>> = {}): Request {
  return new Request("https://portfolio.example/api/fx/usd-cny", {
    headers,
  });
}

afterEach(() => {
  resetFxRouteSecurityForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/fx/usd-cny", () => {
  it("rejects cross-site browser requests before either provider", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      request({
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the credential-free ECB reference rate when Alpaca credentials are absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:01Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(new URL(String(input)).hostname).toBe(
        "data-api.ecb.europa.eu",
      );
      return new Response(ECB_CSV, {
        status: 200,
        headers: ECB_HEADERS,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      kind: "USD_CNY_RATE",
      rate: {
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "6.75132782",
        provider: "ecb",
        rateType: "REFERENCE",
        referenceDate: "2026-07-31",
        sourceEventAt: "2026-07-31T13:57:02.000Z",
        fetchedAt: "2026-08-02T08:00:01.000Z",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the Alpaca USDCNY midpoint without exposing credentials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:01Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "private-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "private-secret");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1beta1/forex/latest/rates");
      expect(url.searchParams.get("currency_pairs")).toBe("USDCNY");
      expect(init?.headers).toMatchObject({
        "APCA-API-KEY-ID": "private-key-id",
        "APCA-API-SECRET-KEY": "private-secret",
      });
      return new Response(
        JSON.stringify({
          rates: {
            USDCNY: {
              bp: 7.19,
              mp: 7.2,
              ap: 7.21,
              t: "2026-08-02T08:00:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      kind: "USD_CNY_RATE",
      rate: {
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        provider: "alpaca",
        rateType: "MIDPOINT",
        sourceEventAt: "2026-08-02T08:00:00Z",
        fetchedAt: "2026-08-02T08:00:01.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-key-id");
    expect(JSON.stringify(body)).not.toContain("private-secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated requests behind a fifteen-minute instance cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:01Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(ECB_CSV, {
        status: 200,
        headers: ECB_HEADERS,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await GET(request({ "X-Forwarded-For": "203.0.113.10" }));
    const second = await GET(request({ "X-Forwarded-For": "203.0.113.11" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(second.json()).resolves.toEqual(await first.json());
  });

  it("falls back to ECB when Alpaca is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:01Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const hostname = new URL(String(input)).hostname;
      return hostname === "data.alpaca.markets"
        ? new Response("upstream unavailable", { status: 503 })
        : new Response(ECB_CSV, {
            status: 200,
            headers: ECB_HEADERS,
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "USD_CNY_RATE",
      rate: {
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "6.75132782",
        provider: "ecb",
        rateType: "REFERENCE",
        referenceDate: "2026-07-31",
        sourceEventAt: "2026-07-31T13:57:02.000Z",
        fetchedAt: "2026-08-02T08:00:01.000Z",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a compact safe error only when both sources are unavailable", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("upstream unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      kind: "ERROR",
      code: "FX_RATE_UNAVAILABLE",
      message: "人民币估算汇率暂时不可用，当前继续显示 USD。",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
