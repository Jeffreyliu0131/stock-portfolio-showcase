import { describe, expect, it, vi } from "vitest";

import { requestBuffettResearch } from "../application/ai/research/browser/buffett-research-client.ts";
import {
  aaplResearchRequest,
  aaplResearchSuccess,
} from "./buffett-research-fixtures.ts";

describe("Buffett research browser client", () => {
  it("sends only the bounded research request and validates the result", async () => {
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toEqual(aaplResearchRequest());
      expect(String(init.body)).not.toContain("quantity");
      return new Response(JSON.stringify(aaplResearchSuccess()), {
        status: 200,
      });
    });
    await expect(
      requestBuffettResearch(aaplResearchRequest(), fetchMock),
    ).resolves.toMatchObject({
      kind: "BUFFETT_RESEARCH_RESULT",
      symbol: "AAPL",
      ownerEarnings: { status: "ASSUMPTION_REQUIRED" },
    });
  });

  it("rejects a result that does not match the requested issuer", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ...aaplResearchSuccess(), symbol: "MSFT" }),
        { status: 200 },
      ),
    );
    await expect(
      requestBuffettResearch(aaplResearchRequest(), fetchMock),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a non-HTTPS or non-official source before rendering", async () => {
    const success = aaplResearchSuccess();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ...success,
          evidence: [
            { ...success.evidence[0]!, url: "javascript:alert(1)" },
            ...success.evidence.slice(1),
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      requestBuffettResearch(aaplResearchRequest(), fetchMock),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
