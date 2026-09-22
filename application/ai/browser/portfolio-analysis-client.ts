import {
  parsePortfolioAiApiResponse,
  type PortfolioAiAnalysisSuccess,
  type PortfolioAiApiErrorCode,
  type PortfolioAiFactsRequest,
} from "../portfolio-analysis-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export class PortfolioAiClientError extends Error {
  readonly code: PortfolioAiApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: PortfolioAiApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "PortfolioAiClientError";
    this.code = code;
  }
}

export type PortfolioAiFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function requestPortfolioAiAnalysis(
  request: PortfolioAiFactsRequest,
  fetchImpl: PortfolioAiFetch = globalThis.fetch,
): Promise<PortfolioAiAnalysisSuccess> {
  let response: Response;
  try {
    const url = providerApiUrl("/api/ai/portfolio-analysis");
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
    throw new PortfolioAiClientError(
      "AI_PROVIDER_UNAVAILABLE",
      "无法连接 AI 解读服务；上方确定性分析仍可使用。",
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PortfolioAiClientError(
      "INVALID_RESPONSE",
      "AI 解读服务返回了无效响应。",
    );
  }
  const parsed = parsePortfolioAiApiResponse(raw, request.evidence);
  if (parsed === null) {
    throw new PortfolioAiClientError(
      "INVALID_RESPONSE",
      "AI 解读服务返回了无效响应。",
    );
  }
  if (parsed.kind === "ERROR") {
    throw new PortfolioAiClientError(parsed.code, parsed.message);
  }
  if (!response.ok) {
    throw new PortfolioAiClientError(
      "INVALID_RESPONSE",
      "AI 解读服务返回了无效状态。",
    );
  }
  return parsed;
}
