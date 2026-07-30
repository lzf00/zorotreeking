const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

/**
 * GitHub variables should contain only a verification token. If a complete
 * meta tag was pasted by mistake, recover its content value without emitting
 * the surrounding HTML into the generated page.
 */
export function normalizeVerificationToken(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;

  const contentMatch = raw.match(
    /\bcontent\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const token = (contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? raw).trim();
  return TOKEN_PATTERN.test(token) ? token : undefined;
}
