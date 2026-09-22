import {
  parseBuffettResearchApiResponse,
  type BuffettResearchApiErrorCode,
  type BuffettResearchRequest,
  type BuffettResearchSuccess,
} from "../buffett-research-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../../http/provider-proxy-contract.ts";

export class BuffettResearchClientError extends Error {
  readonly code: BuffettResearchApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: BuffettResearchApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "BuffettResearchClientError";
    this.code = code;
  }
}

export type BuffettResearchFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function requestBuffettResearch(
  request: BuffettResearchRequest,
  fetchImpl: BuffettResearchFetch = globalThis.fetch,
): Promise<BuffettResearchSuccess> {
  const url = providerApiUrl("/api/ai/buffett-research");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: isVercelProviderUrl(url) ? "omit" : "same-origin",
    });
  } catch {
    throw new BuffettResearchClientError(
      "AI_PROVIDER_UNAVAILABLE",
      "无法连接巴菲特研究系统。",
    );
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new BuffettResearchClientError(
      "INVALID_RESPONSE",
      "研究系统返回了无效响应。",
    );
  }
  const parsed = parseBuffettResearchApiResponse(raw, request);
  if (parsed === null) {
    throw new BuffettResearchClientError(
      "INVALID_RESPONSE",
      "研究系统返回了无效响应。",
    );
  }
  if (parsed.kind === "ERROR") {
    throw new BuffettResearchClientError(parsed.code, parsed.message);
  }
  if (!response.ok) {
    throw new BuffettResearchClientError(
      "INVALID_RESPONSE",
      "研究系统返回了无效状态。",
    );
  }
  return parsed;
}
