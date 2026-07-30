/**
 * Normalize a URL for same-origin links and media attributes.
 * Returns "#" for external origins, non-HTTP protocols, and invalid input.
 */
export function normalizeSameOriginUrl(value: unknown, origin: string): string {
  try {
    const base = new URL(origin);
    const url = new URL(String(value ?? ""), base);
    if (
      !["http:", "https:"].includes(base.protocol)
      || !["http:", "https:"].includes(url.protocol)
      || url.origin !== base.origin
    ) {
      return "#";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "#";
  }
}
