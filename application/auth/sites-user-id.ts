export async function stableSitesUserId(
  forwardedUserId: string | null,
  email: string,
): Promise<string> {
  const direct = forwardedUserId?.trim();
  if (direct) {
    return direct;
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("authenticated email is required");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizedEmail),
  );
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `email-sha256:${hex}`;
}
