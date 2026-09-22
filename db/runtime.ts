import { sitesRuntimeBinding } from "../application/runtime/server-environment.ts";
import type { D1DatabaseLike } from "./index.ts";

export function getPortfolioDatabase(): D1DatabaseLike {
  const database = sitesRuntimeBinding<D1DatabaseLike>("DB");
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB`.",
    );
  }
  return database;
}
