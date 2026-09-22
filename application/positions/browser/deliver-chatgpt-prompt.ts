import {
  copyPortfolioText,
  type PortfolioTextCopyEnvironment,
  type PortfolioTextCopyResult,
} from "./copy-portfolio-text.ts";

export type ChatGptPromptDeliveryResult = PortfolioTextCopyResult;

export interface ChatGptPromptDeliveryEnvironment
  extends PortfolioTextCopyEnvironment {
  readonly navigate: (url: string) => void;
}

function defaultEnvironment(): ChatGptPromptDeliveryEnvironment {
  const clipboard =
    typeof globalThis.navigator === "undefined"
      ? undefined
      : globalThis.navigator.clipboard;

  return {
    ...(clipboard === undefined ? {} : { clipboard }),
    navigate: (url) => {
      globalThis.location.assign(url);
    },
  };
}

export function buildChatGptPromptUrl(text: string): string {
  return `https://chatgpt.com/?prompt=${encodeURIComponent(text)}`;
}

export async function deliverChatGptPrompt(
  text: string,
  environment: ChatGptPromptDeliveryEnvironment = defaultEnvironment(),
): Promise<ChatGptPromptDeliveryResult> {
  // Both calls must remain before the first await so WebKit sees one user gesture.
  const copyOperation = copyPortfolioText(text, environment);
  environment.navigate(buildChatGptPromptUrl(text));
  return copyOperation;
}
