const SITES_ENVIRONMENT_KEY = "__STOCK_PORTFOLIO_SITES_ENVIRONMENT__";

type RuntimeGlobal = typeof globalThis & {
  [SITES_ENVIRONMENT_KEY]?: Readonly<Record<string, unknown>>;
  readonly process?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
  };
};

function runtimeGlobal(): RuntimeGlobal {
  return globalThis as RuntimeGlobal;
}

export function installSitesRuntimeEnvironment(
  value: Readonly<Record<string, unknown>>,
): void {
  runtimeGlobal()[SITES_ENVIRONMENT_KEY] = value;
}

export function sitesRuntimeBinding<T>(name: string): T | undefined {
  return runtimeGlobal()[SITES_ENVIRONMENT_KEY]?.[name] as T | undefined;
}

export function serverEnvironmentValue(name: string): string | undefined {
  const sitesValue = sitesRuntimeBinding<unknown>(name);
  if (typeof sitesValue === "string") {
    return sitesValue;
  }
  return runtimeGlobal().process?.env?.[name];
}
