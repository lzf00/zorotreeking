export type SectorChange = {
  code: string;
  name: string;
  change_pct: number | null;
};

export type LaggingSectorClassification<T extends SectorChange> = {
  /** 语义而不是文案：列表标题由组件按页面语言决定 */
  kind: "decliners" | "relative-bottom";
  direction: "down" | "up";
  items: T[];
};

/** Keep a relative bottom-ten list from being presented as an absolute decline. */
export function classifyLaggingSectors<T extends SectorChange>(
  items: T[],
): LaggingSectorClassification<T> {
  const decliners = items.filter(
    (item) => item.change_pct !== null && item.change_pct < 0,
  );
  if (decliners.length > 0) {
    return { kind: "decliners", direction: "down", items: decliners };
  }
  return { kind: "relative-bottom", direction: "up", items };
}
