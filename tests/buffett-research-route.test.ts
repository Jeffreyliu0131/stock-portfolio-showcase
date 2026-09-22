import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/ai/buffett-research/route.ts";
import { resetBuffettResearchRateLimitForTests } from "../application/http/public-route-rate-limiters.ts";
import {
  aaplResearchRequest,
  officialWebSearchResponse,
  syntheticSecCompanyFacts,
  syntheticSecSubmissions,
  synthesisResponse,
} from "./buffett-research-fixtures.ts";

function routeRequest(
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request("https://portfolio.example/api/ai/buffett-research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.18",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetBuffettResearchRateLimitForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/ai/buffett-research", () => {
  it("rejects cross-site and unsupported-issuer requests before any upstream call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const crossSite = await POST(
      routeRequest(aaplResearchRequest(), {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      }),
    );
    expect(crossSite.status).toBe(403);
    const unsupported = await POST(
      routeRequest({ ...aaplResearchRequest(), symbol: "TSLA" }),
    );
    expect(unsupported.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails safely before SEC or OpenAI when server configuration is absent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("SEC_RESEARCH_USER_AGENT", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const result = await POST(routeRequest(aaplResearchRequest()));
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "RESEARCH_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns one fully validated research result with no-store", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv(
      "SEC_RESEARCH_USER_AGENT",
      "StockPortfolioResearch/0.1 contact@example.com",
    );
    vi.stubEnv("OPENAI_RESEARCH_MODEL", "gpt-5.5");
    let openAiCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions")) {
        return new Response(JSON.stringify(syntheticSecSubmissions()), {
          status: 200,
        });
      }
      if (url.includes("data.sec.gov/api/xbrl/companyfacts")) {
        return new Response(JSON.stringify(syntheticSecCompanyFacts()), {
          status: 200,
        });
      }
      openAiCalls += 1;
      return new Response(
        JSON.stringify(
          openAiCalls === 1
            ? officialWebSearchResponse()
            : synthesisResponse(),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await POST(routeRequest(aaplResearchRequest()));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(result.json()).resolves.toMatchObject({
      kind: "BUFFETT_RESEARCH_RESULT",
      symbol: "AAPL",
      companyName: "Apple Inc.",
      model: "gpt-5.5",
      ownerEarnings: { status: "ASSUMPTION_REQUIRED" },
    });
    expect(openAiCalls).toBe(2);
  });

  it("applies a low per-caller research budget", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("SEC_RESEARCH_USER_AGENT", "");
    for (let index = 0; index < 4; index += 1) {
      expect((await POST(routeRequest(aaplResearchRequest()))).status).toBe(503);
    }
    const limited = await POST(routeRequest(aaplResearchRequest()));
    expect(limited.status).toBe(429);
  });
});
