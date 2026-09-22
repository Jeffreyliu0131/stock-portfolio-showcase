import { describe, expect, it } from "vitest";

import {
  SITES_APP_ORIGIN,
  VERCEL_PROVIDER_ORIGIN,
  isVercelProviderUrl,
  providerApiUrl,
} from "../application/http/provider-proxy-contract.ts";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "../application/http/provider-proxy-cors.ts";

describe("Sites provider proxy contract", () => {
  it("routes only the deployed Sites origin to the fixed Vercel backend", () => {
    expect(providerApiUrl("/api/quotes", SITES_APP_ORIGIN)).toBe(
      `${VERCEL_PROVIDER_ORIGIN}/api/quotes`,
    );
    expect(providerApiUrl("/api/quotes", "http://localhost:3000")).toBe(
      "/api/quotes",
    );
    expect(providerApiUrl("/api/quotes", VERCEL_PROVIDER_ORIGIN)).toBe(
      "/api/quotes",
    );
    expect(
      isVercelProviderUrl(`${VERCEL_PROVIDER_ORIGIN}/api/fx/usd-cny`),
    ).toBe(true);
    expect(() => providerApiUrl("/not-api", SITES_APP_ORIGIN)).toThrow();
  });

  it("accepts same-origin operations and the one trusted Sites origin", () => {
    expect(
      requestIsAllowedProviderClient(
        new Request("https://provider.example/api/quotes"),
      ),
    ).toBe(true);
    expect(
      requestIsAllowedProviderClient(
        new Request("https://provider.example/api/quotes", {
          headers: {
            Origin: SITES_APP_ORIGIN,
            "Sec-Fetch-Site": "cross-site",
          },
        }),
      ),
    ).toBe(true);
    expect(
      requestIsAllowedProviderClient(
        new Request("https://provider.example/api/quotes", {
          headers: {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
          },
        }),
      ),
    ).toBe(false);
  });

  it("returns a bounded CORS preflight only to Sites", () => {
    const trusted = providerCorsPreflight(
      new Request("https://provider.example/api/quotes", {
        method: "OPTIONS",
        headers: {
          Origin: SITES_APP_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      "POST",
    );
    expect(trusted.status).toBe(204);
    expect(trusted.headers.get("access-control-allow-origin")).toBe(
      SITES_APP_ORIGIN,
    );
    expect(trusted.headers.get("access-control-max-age")).toBe("600");

    const attacker = providerCorsPreflight(
      new Request("https://provider.example/api/quotes", {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
      "POST",
    );
    expect(attacker.status).toBe(403);
  });
});
