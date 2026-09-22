import { VERCEL_PROVIDER_ORIGIN } from "../application/http/provider-proxy-contract";

function publicPwaIcon(path: string): string {
  return new URL(path, VERCEL_PROVIDER_ORIGIN).href;
}

export const PWA_ICONS = {
  favicon32: publicPwaIcon("/icons/portfolio-aurora-32.png"),
  appleTouch180: publicPwaIcon("/icons/apple-touch-icon-aurora.png"),
  any192: publicPwaIcon("/icons/portfolio-aurora-192.png"),
  any512: publicPwaIcon("/icons/portfolio-aurora-512.png"),
  maskable512: publicPwaIcon("/icons/portfolio-aurora-maskable-512.png"),
} as const;
