/**
 * Serialize structured data for an inline application/ld+json script.
 *
 * JSON.stringify alone is not safe inside HTML: a content value containing
 * `</script>` can terminate the script element before the HTML parser reaches
 * the intended closing tag. Escaping HTML-significant code points preserves
 * the JSON value while keeping the surrounding document intact.
 */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(
    value,
    (_, item) => item === undefined ? undefined : item,
  ) ?? "null";

  return json.replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      case "\u2029": return "\\u2029";
      default: return character;
    }
  });
}
