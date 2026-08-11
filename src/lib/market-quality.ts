export type SectorChange = {
  code: string;
  name: string;
  change_pct: number | null;
};

export type LaggingSectorClassification<T extends SectorChange> = {
  title: "跌幅榜" | "涨幅后十";
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
    return { title: "跌幅榜", direction: "down", items: decliners };
  }
  return { title: "涨幅后十", direction: "up", items };
}
