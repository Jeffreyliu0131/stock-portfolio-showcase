import type { MetadataRoute } from "next";

import { PWA_ICONS } from "./pwa-branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "总仓位",
    short_name: "总仓位",
    description:
      "合并查看个人美股持仓与延迟估值，并直接向价值投资框架顾问提问。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f2f4f7",
    theme_color: "#07090d",
    lang: "zh-CN",
    categories: ["finance", "utilities"],
    icons: [
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
    ],
  };
}
