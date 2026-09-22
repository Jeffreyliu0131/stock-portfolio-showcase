import { productionExperience } from "../../runtime/build-target.ts";
import { normalizeLegacyPortfolioResponse } from "../portfolio-wire-compatibility.ts";
import {
  parsePortfolioConsultationApiResponse,
  type PortfolioConsultationApiErrorCode,
  type PortfolioConsultationRequest,
  type PortfolioConsultationSuccess,
} from "../portfolio-consultation-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export class PortfolioConsultationClientError extends Error {
  readonly code: PortfolioConsultationApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: PortfolioConsultationApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "PortfolioConsultationClientError";
    this.code = code;
  }
}

export type PortfolioConsultationFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function requestPortfolioConsultation(
  request: PortfolioConsultationRequest,
  fetchImpl: PortfolioConsultationFetch = globalThis.fetch,
): Promise<PortfolioConsultationSuccess> {
  let response: Response;
  try {
    const url = providerApiUrl("/api/ai/portfolio-analysis");
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productionExperience() ? { ...request, schemaVersion: 3 } : request),
      cache: "no-store",
      credentials: isVercelProviderUrl(url) ? "omit" : "same-origin",
    });
  } catch {
    throw new PortfolioConsultationClientError(
      "AI_PROVIDER_UNAVAILABLE",
      "无法连接 AI 组合咨询；下方确定性分析仍可使用。",
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PortfolioConsultationClientError(
      "INVALID_RESPONSE",
      "AI 组合咨询返回了无效响应。",
    );
  }
  const parsed = parsePortfolioConsultationApiResponse(productionExperience() ? normalizeLegacyPortfolioResponse(raw) : raw, request);
  if (parsed === null) {
    throw new PortfolioConsultationClientError(
      "INVALID_RESPONSE",
      "AI 组合咨询返回了无效响应。",
    );
  }
  if (parsed.kind === "ERROR") {
    throw new PortfolioConsultationClientError(parsed.code, parsed.message);
  }
  if (!response.ok) {
    throw new PortfolioConsultationClientError(
      "INVALID_RESPONSE",
      "AI 组合咨询返回了无效状态。",
    );
  }
  return parsed;
}
