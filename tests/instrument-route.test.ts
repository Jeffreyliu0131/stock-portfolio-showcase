import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/instruments/resolve/route.ts";
import { resetInstrumentRateLimitForTests } from "../application/http/public-route-rate-limiters.ts";

function request(body: unknown): Request {
  return new Request("http://localhost/api/instruments/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetInstrumentRateLimitForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/instruments/resolve", () => {
  it("rejects cross-site, non-JSON, oversized, and extra-field requests before Alpaca", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const crossSite = await POST(
      new Request("https://portfolio.example/api/instruments/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ symbol: "AAPL" }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const nonJson = await POST(
      new Request("https://portfolio.example/api/instruments/resolve", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ symbol: "AAPL" }),
      }),
    );
    expect(nonJson.status).toBe(415);

    const oversized = await POST(
      new Request("https://portfolio.example/api/instruments/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "AAPL", padding: "x".repeat(1_100) }),
      }),
    );
    expect(oversized.status).toBe(413);

    const extraField = await POST(
      request({ symbol: "AAPL", accountNumber: "private" }),
    );
    expect(extraField.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid symbol before contacting Alpaca", async () => {
    const result = await POST(
      request({
        symbol: "AAPL,MSFT",
      }),
    );

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "INSTRUMENT_NOT_SUPPORTED",
    });
  });

  it("fails without exposing data credentials when unconfigured", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const result = await POST(
      request({
        symbol: "AAPL",
      }),
    );
    const body = await result.json();

    expect(result.status).toBe(503);
    expect(body).toEqual({
      kind: "ERROR",
      code: "INSTRUMENT_SERVICE_NOT_CONFIGURED",
      message: "Alpaca 标的验证尚未配置。",
    });
    expect(JSON.stringify(body)).not.toContain("ALPACA_API");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an unapproved trading API origin", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "private-key");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "private-secret");
    vi.stubEnv("ALPACA_TRADING_API_BASE_URL", "https://example.com");

    const result = await POST(
      request({
        symbol: "AAPL",
      }),
    );
    const serialized = JSON.stringify(await result.json());

    expect(result.status).toBe(503);
    expect(serialized).not.toContain("private-key");
    expect(serialized).not.toContain("private-secret");
  });
});
