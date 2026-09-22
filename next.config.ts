import type { NextConfig } from "next";
import { SITES_APP_ORIGIN } from "./application/http/provider-proxy-contract.ts";
import { SECURITY_HEADERS } from "./application/http/security-headers.ts";

const providerCorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: SITES_APP_ORIGIN },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type" },
  { key: "Access-Control-Expose-Headers", value: "Retry-After" },
  { key: "Access-Control-Max-Age", value: "600" },
  { key: "Vary", value: "Origin" },
] as const;

const publicPwaIconHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
] as const;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_PUBLIC_PORTFOLIO_TARGET === "demo" ? ".next-demo" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    sri: { algorithm: "sha384" },
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        has: [
          {
            type: "header",
            key: "origin",
            value: SITES_APP_ORIGIN,
          },
        ],
        headers: [...providerCorsHeaders],
      },
      {
        source: "/(.*)",
        headers: [...SECURITY_HEADERS],
      },
      {
        source: "/icons/:path*",
        headers: [...publicPwaIconHeaders],
      },
    ];
  },
};

export default nextConfig;
