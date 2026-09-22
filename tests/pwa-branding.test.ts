import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";
import manifest from "@/app/manifest";
import { PWA_ICONS } from "@/app/pwa-branding";
import { VERCEL_PROVIDER_ORIGIN } from "@/application/http/provider-proxy-contract";

const PNG_SIGNATURE = "89504e470d0a1a0a";

function workspacePath(publicUrl: string): string {
  const parsed = new URL(publicUrl);
  expect(parsed.origin).toBe(VERCEL_PROVIDER_ORIGIN);
  return fileURLToPath(new URL(`../public${parsed.pathname}`, import.meta.url));
}

async function readPngDimensions(publicPath: string) {
  const image = await readFile(workspacePath(publicPath));

  expect(image.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);

  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

describe("PWA branding", () => {
  it("keeps install icons public without widening access to the Sites app", () => {
    for (const iconUrl of Object.values(PWA_ICONS)) {
      expect(new URL(iconUrl).origin).toBe(VERCEL_PROVIDER_ORIGIN);
    }
  });

  it("publishes discoverable browser and Apple icon metadata without request-time headers", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(metadata.icons).toEqual({
      icon: [
        { url: PWA_ICONS.favicon32, sizes: "32x32", type: "image/png" },
        { url: PWA_ICONS.any192, sizes: "192x192", type: "image/png" },
        { url: PWA_ICONS.any512, sizes: "512x512", type: "image/png" },
      ],
      apple: [
        {
          url: PWA_ICONS.appleTouch180,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    });
  });

  it("publishes versioned Aurora icons through the web app manifest", () => {
    expect(manifest().icons).toEqual([
      {
        src: PWA_ICONS.any192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: PWA_ICONS.any512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: PWA_ICONS.maskable512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it.each([
    [PWA_ICONS.favicon32, 32],
    [PWA_ICONS.appleTouch180, 180],
    [PWA_ICONS.any192, 192],
    [PWA_ICONS.any512, 512],
    [PWA_ICONS.maskable512, 512],
  ] as const)("ships %s at %d × %d pixels", async (publicPath, size) => {
    await expect(readPngDimensions(publicPath)).resolves.toEqual({
      width: size,
      height: size,
    });
  });
});
