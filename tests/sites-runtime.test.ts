import { afterEach, describe, expect, it, vi } from "vitest";

import { stableSitesUserId } from "../application/auth/sites-user-id.ts";
import {
  installSitesRuntimeEnvironment,
  serverEnvironmentValue,
  sitesRuntimeBinding,
} from "../application/runtime/server-environment.ts";

afterEach(() => {
  installSitesRuntimeEnvironment({});
  vi.unstubAllEnvs();
});

describe("Sites runtime integration", () => {
  it("prefers a forwarded stable user id", async () => {
    await expect(
      stableSitesUserId("sites-user-123", "owner@example.com"),
    ).resolves.toBe("sites-user-123");
  });

  it("derives a stable pseudonymous key when Sites only forwards email", async () => {
    const first = await stableSitesUserId(null, " Owner@Example.com ");
    const second = await stableSitesUserId(null, "owner@example.com");
    expect(first).toBe(second);
    expect(first).toMatch(/^email-sha256:[0-9a-f]{64}$/);
    expect(first).not.toContain("owner@example.com");
  });

  it("reads hosted Worker bindings before local process env", () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "local-value");
    installSitesRuntimeEnvironment({
      ALPACA_API_KEY_ID: "hosted-value",
      DB: { binding: true },
    });
    expect(serverEnvironmentValue("ALPACA_API_KEY_ID")).toBe("hosted-value");
    expect(sitesRuntimeBinding("DB")).toEqual({ binding: true });
  });
});
