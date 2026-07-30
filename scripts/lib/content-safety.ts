/**
 * Keep Markdown formatting while neutralizing raw HTML and MDX expressions
 * coming from external feeds or model output.
 */
export function sanitizeExternalTextForMdx(value: string): string {
  return String(value ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/**
 * External links written into generated MDX must use a web protocol.
 */
export function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
