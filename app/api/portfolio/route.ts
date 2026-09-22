import { portfolioTarget } from "../../../application/runtime/build-target.ts";
import {
  DomainValidationError,
} from "../../../domain/index.ts";
import { SlidingWindowRateLimiter } from "../../../application/ai/server/sliding-window-rate-limiter.ts";
import {
  BrokerPortfolioBackupValidationError,
} from "../../../application/brokerage/backup.ts";
import {
  CLOUD_PORTFOLIO_REQUEST_MAX_BYTES,
  parseCloudPortfolioMutation,
  type CloudPortfolioApiError,
  type CloudPortfolioMutationResponse,
} from "../../../application/cloud/portfolio-api.ts";
import {
  cloudPortfolioStateView,
} from "../../../application/cloud/portfolio-state.ts";
import {
  CloudPortfolioStoreConflictError,
  D1PortfolioStore,
} from "../../../application/cloud/server/d1-portfolio-store.ts";
import {
  readBoundedJson,
  requestIsSameOrigin,
} from "../../../application/http/request-security.ts";
import {
  PositionBackupValidationError,
} from "../../../application/positions/position-backup.ts";
import {
  PositionRepositoryError,
} from "../../../application/positions/types.ts";
import { getChatGPTUser } from "../../chatgpt-auth.ts";
import { getPortfolioDatabase } from "../../../db/runtime.ts";

export const dynamic = "force-dynamic";

const limiter = new SlidingWindowRateLimiter({
  limit: 120,
  windowMs: 60_000,
  maxBuckets: 2_000,
});

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

function errorResponse(
  status: number,
  code: CloudPortfolioApiError["code"],
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { kind: "CLOUD_PORTFOLIO_ERROR", code, message } satisfies CloudPortfolioApiError,
    { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } },
  );
}

function invalidRequest(message = "账号持仓请求无效。请刷新后重试。"): Response {
  return errorResponse(400, "INVALID_REQUEST", message);
}

function serverError(): Response {
  return errorResponse(
    503,
    "UNAVAILABLE",
    "账号持仓暂时无法读取；没有修改任何资产。请稍后重试。",
  );
}

async function authenticatedUser() {
  const user = await getChatGPTUser();
  return user;
}

export async function GET(): Promise<Response> {
  if (portfolioTarget() !== "sites") return new Response(null, { status: 404 });
  const user = await authenticatedUser();
  if (user === null) {
    return errorResponse(401, "AUTHENTICATION_REQUIRED", "请先使用 ChatGPT 登录。");
  }
  try {
    const loaded = await new D1PortfolioStore(getPortfolioDatabase()).load(user.userId);
    return Response.json(
      cloudPortfolioStateView(loaded.state, loaded.stateRevision),
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return serverError();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (portfolioTarget() !== "sites") return new Response(null, { status: 404 });
  if (!requestIsSameOrigin(request)) {
    return errorResponse(403, "INVALID_REQUEST", "不允许跨站修改账号持仓。");
  }
  const user = await authenticatedUser();
  if (user === null) {
    return errorResponse(401, "AUTHENTICATION_REQUIRED", "请先使用 ChatGPT 登录。");
  }
  const decision = limiter.take(user.userId);
  if (!decision.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "操作过于频繁，请稍后重试。",
      { "Retry-After": String(decision.retryAfterSeconds) },
    );
  }

  const body = await readBoundedJson(request, CLOUD_PORTFOLIO_REQUEST_MAX_BYTES);
  if (!body.ok) {
    if (body.reason === "UNSUPPORTED_MEDIA_TYPE") {
      return errorResponse(415, "INVALID_REQUEST", "请求必须使用 JSON。");
    }
    if (body.reason === "TOO_LARGE") {
      return errorResponse(413, "INVALID_REQUEST", "账号持仓数据超过大小限制。");
    }
    return invalidRequest();
  }

  try {
    const mutation = parseCloudPortfolioMutation(body.value);
    const result = await new D1PortfolioStore(getPortfolioDatabase()).mutate(
      user.userId,
      mutation,
    );
    return Response.json(
      {
        kind: "CLOUD_PORTFOLIO_MUTATION_RESULT",
        action: mutation.action,
        changed: result.changed,
        state: cloudPortfolioStateView(result.state, result.stateRevision),
      } satisfies CloudPortfolioMutationResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (
      error instanceof CloudPortfolioStoreConflictError ||
      (error instanceof PositionRepositoryError &&
        [
          "POSITION_SNAPSHOT_CONFLICT",
          "CASH_SNAPSHOT_CONFLICT",
          "BROKER_PORTFOLIO_CONFLICT",
          "BACKUP_RESTORE_TARGET_NOT_EMPTY",
        ].includes(error.code))
    ) {
      return errorResponse(
        409,
        "CONFLICT",
        "账号持仓已在另一设备或页面发生变化；本次操作没有写入，请刷新后重试。",
      );
    }
    if (
      error instanceof DomainValidationError ||
      error instanceof PositionRepositoryError ||
      error instanceof PositionBackupValidationError ||
      error instanceof BrokerPortfolioBackupValidationError ||
      (error instanceof Error && error.message.startsWith("invalid cloud portfolio payload"))
    ) {
      return invalidRequest();
    }
    return serverError();
  }
}
