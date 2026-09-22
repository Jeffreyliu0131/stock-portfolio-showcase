import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.ts";
import {
  SITES_APP_ORIGIN,
  VERCEL_PROVIDER_ORIGIN,
} from "../application/http/provider-proxy-contract.ts";
import { CONTENT_SECURITY_POLICY } from "../application/http/security-headers.ts";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  readonly scripts?: Readonly<Record<string, string>>;
};

describe("production security headers", () => {
  it("applies transport, framing, MIME, and cross-origin isolation headers globally", async () => {
    const routes = await nextConfig.headers?.();
    const wildcard = routes?.find((route) => route.source === "/(.*)");
    const headers = new Map(
      wildcard?.headers.map((header) => [header.key, header.value]) ?? [],
    );

    expect(nextConfig.poweredByHeader).toBe(false);
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("allowlists only the fixed Vercel provider origin for browser connections", async () => {
    const routes = await nextConfig.headers?.();
    const csp = routes
      ?.find((route) => route.source === "/(.*)")
      ?.headers.find((header) => header.key === "Content-Security-Policy")
      ?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).not.toContain("http:");
    expect(csp).toContain(
      `connect-src 'self' ${VERCEL_PROVIDER_ORIGIN}`,
    );
    expect(csp).toContain(
      `img-src 'self' data: blob: ${VERCEL_PROVIDER_ORIGIN}`,
    );
    expect(csp?.match(/https:/g)).toHaveLength(2);
    expect(nextConfig.experimental?.sri).toEqual({ algorithm: "sha384" });
  });

  it("allows only versioned public PWA icons to load cross-origin", async () => {
    const routes = await nextConfig.headers?.();
    const icons = routes?.find((route) => route.source === "/icons/:path*");
    const headers = new Map(
      icons?.headers.map((header) => [header.key, header.value]) ?? [],
    );

    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("uses one CSP source for both framework and Sites Worker responses", async () => {
    const routes = await nextConfig.headers?.();
    const frameworkCsp = routes
      ?.find((route) => route.source === "/(.*)")
      ?.headers.find((header) => header.key === "Content-Security-Policy")
      ?.value;

    expect(frameworkCsp).toBe(CONTENT_SECURITY_POLICY);
  });

  it("adds CORS only for the fixed Sites origin on provider APIs", async () => {
    const routes = await nextConfig.headers?.();
    const cors = routes?.find((route) => route.source === "/api/:path*");
    const headers = new Map(
      cors?.headers.map((header) => [header.key, header.value]) ?? [],
    );

    expect(cors?.has).toEqual([
      { type: "header", key: "origin", value: SITES_APP_ORIGIN },
    ]);
    expect(headers.get("Access-Control-Allow-Origin")).toBe(SITES_APP_ORIGIN);
    expect(headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(headers.get("Vary")).toBe("Origin");
  });

  it("keeps deployment wiring ignored while exposing explicit build targets", () => {
    expect(packageJson.scripts?.["build:provider"]).toContain("build-target.mjs provider");
    expect(packageJson.scripts?.["build:sites"]).toContain("build-target.mjs sites");
    const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(ignore).toContain(".deployment/");
    expect(ignore).toContain(".openai/hosting.json");
  });
});
