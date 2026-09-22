import { portfolioTarget } from "../application/runtime/build-target.ts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { stableSitesUserId } from "../application/auth/sites-user-id.ts";

export interface ChatGPTUser {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly fullName: string | null;
}

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

function developmentUser(): ChatGPTUser | null {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  return {
    userId: "local-development-user",
    displayName: "本地预览账号",
    email: "local-preview@example.invalid",
    fullName: "本地预览账号",
  };
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) {
    return developmentUser();
  }
  const userId = await stableSitesUserId(
    requestHeaders.get(USER_ID_HEADER),
    email,
  );

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  if (portfolioTarget() !== "sites") return { userId: "local-only", displayName: "", email: "", fullName: null };
  const user = await getChatGPTUser();
  if (user) {
    return user;
  }
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(
    safeRelativeReturnPath(returnTo),
  )}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(
    safeRelativeReturnPath(returnTo),
  )}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  try {
    const url = new URL(value, "https://app.local");
    if (
      url.origin !== "https://app.local" ||
      isReservedAuthPath(url.pathname)
    ) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
