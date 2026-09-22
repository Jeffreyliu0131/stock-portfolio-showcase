import { sitesRuntimeBinding } from "./server-environment.ts";

function safeDetail(value: unknown): string {
  if (typeof value === "number") {
    return `http_${value}`;
  }
  if (typeof value === "string") {
    return value.slice(0, 120);
  }
  if (value instanceof Error) {
    const message = value.message
      .replace(/https?:\/\/\S+/giu, "[url]")
      .replace(/[A-Za-z0-9_-]{24,}/gu, "[redacted]")
      .slice(0, 160);
    return `${value.name}:${message}`;
  }
  return "unknown";
}

export function logSitesUpstreamFailure(
  provider: string,
  detail: unknown,
): void {
  if (sitesRuntimeBinding("DB") === undefined) {
    return;
  }
  console.error(
    JSON.stringify({
      event: "SITES_UPSTREAM_FAILURE",
      provider,
      detail: safeDetail(detail),
    }),
  );
}
