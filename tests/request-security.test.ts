import { describe, expect, it } from "vitest";

import {
  callerKey,
  readBoundedJson,
  requestIsSameOrigin,
} from "../application/http/request-security.ts";

function jsonRequest(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request("https://portfolio.example/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body,
  });
}

describe("server request security", () => {
  it("accepts same-origin browser requests and operational requests without browser metadata", () => {
    expect(
      requestIsSameOrigin(
        jsonRequest("{}", {
          Origin: "https://portfolio.example",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).toBe(true);
    expect(requestIsSameOrigin(jsonRequest("{}"))).toBe(true);
  });

  it("uses forwarded host metadata without allowing cross-site browser requests", () => {
    const internal = new Request("http://localhost:3417/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portfolio.example",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-Host": "portfolio.example",
        "X-Forwarded-Proto": "https",
      },
      body: "{}",
    });
    expect(requestIsSameOrigin(internal)).toBe(true);
    expect(
      requestIsSameOrigin(
        jsonRequest("{}", {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("reads valid JSON and enforces media type plus declared and measured byte limits", async () => {
    await expect(
      readBoundedJson(jsonRequest('{"symbol":"AAPL"}'), 64),
    ).resolves.toEqual({
      ok: true,
      value: { symbol: "AAPL" },
    });

    await expect(
      readBoundedJson(
        new Request("https://portfolio.example/api/test", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
        64,
      ),
    ).resolves.toEqual({ ok: false, reason: "UNSUPPORTED_MEDIA_TYPE" });

    await expect(
      readBoundedJson(
        jsonRequest("{}", { "Content-Length": "65" }),
        64,
      ),
    ).resolves.toEqual({ ok: false, reason: "TOO_LARGE" });

    await expect(
      readBoundedJson(jsonRequest(`{"value":"${"界".repeat(30)}"}`), 64),
    ).resolves.toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("rejects malformed JSON and invalid declared lengths", async () => {
    await expect(readBoundedJson(jsonRequest("{"), 64)).resolves.toEqual({
      ok: false,
      reason: "INVALID_JSON",
    });
    await expect(
      readBoundedJson(jsonRequest("{}", { "Content-Length": "invalid" }), 64),
    ).resolves.toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("stores only a stable truncated hash for the caller address", async () => {
    const first = await callerKey(
      jsonRequest("{}", { "X-Forwarded-For": "203.0.113.10, 10.0.0.1" }),
    );
    const second = await callerKey(
      jsonRequest("{}", { "X-Forwarded-For": "203.0.113.10" }),
    );
    const other = await callerKey(
      jsonRequest("{}", { "X-Forwarded-For": "203.0.113.11" }),
    );
    expect(first).toBe(second);
    expect(first).toHaveLength(24);
    expect(first).not.toContain("203.0.113.10");
    expect(other).not.toBe(first);
  });
});
