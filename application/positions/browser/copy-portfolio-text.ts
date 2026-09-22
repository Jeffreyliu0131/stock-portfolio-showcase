export type PortfolioTextCopyResult = "copied" | "manual-fallback";

interface ClipboardWriter {
  readonly writeText: (text: string) => Promise<void>;
}

export interface PortfolioTextCopyEnvironment {
  readonly clipboard?: ClipboardWriter;
}

function defaultEnvironment(): PortfolioTextCopyEnvironment {
  if (
    typeof globalThis.navigator === "undefined" ||
    globalThis.navigator.clipboard === undefined
  ) {
    return {};
  }
  return {
    clipboard: globalThis.navigator.clipboard,
  };
}

export async function copyPortfolioText(
  text: string,
  environment: PortfolioTextCopyEnvironment = defaultEnvironment(),
): Promise<PortfolioTextCopyResult> {
  if (environment.clipboard === undefined) {
    return "manual-fallback";
  }
  try {
    // Keep this invocation before any await so WebKit sees the user gesture.
    const write = environment.clipboard.writeText(text);
    await write;
    return "copied";
  } catch {
    return "manual-fallback";
  }
}
