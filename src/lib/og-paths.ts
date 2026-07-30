type LocalizedEntry = {
  data: {
    translationKey: string;
    lang: "zh" | "en";
  };
};

/**
 * OG URLs are language-neutral (`/og/{section}/{translationKey}.png`), so a
 * bilingual pair must generate exactly one image. Prefer the Chinese entry,
 * which matches the site's default locale, and fall back to English-only
 * content.
 */
export function selectCanonicalOgEntries<T extends LocalizedEntry>(entries: T[]): T[] {
  const selected = new Map<string, T>();

  for (const entry of entries) {
    const key = entry.data.translationKey;
    const current = selected.get(key);
    if (!current || (current.data.lang !== "zh" && entry.data.lang === "zh")) {
      selected.set(key, entry);
    }
  }

  return [...selected.values()];
}
