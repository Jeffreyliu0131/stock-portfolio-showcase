import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { installSitesRuntimeEnvironment } from "../application/runtime/server-environment.ts";
import { SECURITY_HEADERS } from "../application/http/security-headers.ts";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  readonly [key: string]: unknown;
  readonly ASSETS: AssetFetcher;
  readonly DB: unknown;
  readonly IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const { key, value } of SECURITY_HEADERS) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: WorkerExecutionContext,
  ): Promise<Response> {
    installSitesRuntimeEnvironment(env);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/portfolio") {
      return withSecurityHeaders(new Response(null, { status: 404 }));
    }
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
      return withSecurityHeaders(response);
    }

    return withSecurityHeaders(await handler.fetch(request, env, context));
  },
};

export default worker;
