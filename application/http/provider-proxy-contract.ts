declare const process: { readonly env: Readonly<Record<string, string | undefined>> };
// Public build-time wiring; validated by scripts/build-target.mjs for releases.
export const SITES_APP_ORIGIN = process.env.NEXT_PUBLIC_SITES_ORIGIN ?? "https://portfolio.example.com";
export const VERCEL_PROVIDER_ORIGIN = process.env.NEXT_PUBLIC_PROVIDER_ORIGIN ?? "https://provider.example.com";

function runtimeOrigin(): string | null {
  const locationValue = (
    globalThis as typeof globalThis & {
      readonly location?: { readonly origin?: string };
    }
  ).location;
  return typeof locationValue?.origin === "string"
    ? locationValue.origin
    : null;
}

export function providerApiUrl(
  path: string,
  currentOrigin: string | null = runtimeOrigin(),
): string {
  if (!path.startsWith("/api/")) {
    throw new Error("provider API path must start with /api/");
  }
  return currentOrigin === SITES_APP_ORIGIN
    ? new URL(path, VERCEL_PROVIDER_ORIGIN).href
    : path;
}

export function isVercelProviderUrl(value: string): boolean {
  try {
    return new URL(value).origin === VERCEL_PROVIDER_ORIGIN;
  } catch {
    return false;
  }
}
