export type Period = "1m" | "3m" | "6m" | "1y" | "all";

export const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

export const CHART_PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "1m", label: "1ヶ月" },
  { value: "3m", label: "3ヶ月" },
  { value: "6m", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "all", label: "全期間" },
];

export type Granularity = "daily" | "monthly";

export const CHART_GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "daily", label: "日次" },
  { value: "monthly", label: "月次" },
];

/** 1 点あたりの幅。下回るとチャートを横スクロールさせる */
const CHART_POINT_WIDTH: Record<Granularity, number> = {
  daily: 10,
  monthly: 40,
};

/** 目盛りラベルを何点おきに出すか。日次は 1 週間おき */
const CHART_LABEL_INTERVAL: Record<Granularity, number> = {
  daily: 7,
  monthly: 1,
};

export type ComparisonPeriod = "daily" | "weekly" | "monthly";

export const COMPARISON_PERIOD_OPTIONS: { value: ComparisonPeriod; label: string }[] = [
  { value: "daily", label: "前日" },
  { value: "weekly", label: "週間" },
  { value: "monthly", label: "月間" },
];

export function roundToNice(value: number): number {
  if (value <= 0) return 100000;

  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;

  const niceValues = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = niceValues.find((n) => n >= normalized) ?? 10;

  return nice * magnitude;
}

export function getCutoffDate(period: Period, now: Date = new Date()): Date | null {
  switch (period) {
    case "1m":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3m":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6m":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "all":
      return null;
  }
}

export function filterDataByPeriod<T extends { date: string }>(
  data: T[],
  period: Period,
  now: Date = new Date(),
): T[] {
  const cutoffDate = getCutoffDate(period, now);

  return cutoffDate ? data.filter((d) => new Date(d.date) >= cutoffDate) : data;
}

/** 各月の最終日だけを残す。 */
export function collapseToMonthly<T extends { date: string }>(data: T[]): T[] {
  const monthlyData = new Map<string, T>();

  for (const point of data) {
    const monthKey = point.date.slice(0, 7);
    if (!monthlyData.has(monthKey) || point.date > monthlyData.get(monthKey)!.date) {
      monthlyData.set(monthKey, point);
    }
  }

  return Array.from(monthlyData.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function resampleByGranularity<T extends { date: string }>(
  data: T[],
  granularity: Granularity,
): T[] {
  return granularity === "monthly" ? collapseToMonthly(data) : data;
}

/** 年は両端の目盛りにだけ付ける。 */
export function formatChartDateLabel(
  date: string,
  granularity: Granularity,
  withYear: boolean,
): string {
  const [year, month, day] = date.split("-");
  if (granularity === "monthly") {
    return withYear ? `${year}/${month}` : `${month}`;
  }
  return withYear ? `${year}/${month}/${day}` : `${month}/${day}`;
}

/**
 * 目盛りラベルの文言。両端は年を付け、間は等間隔に間引く。
 * 両端に寄りすぎた目盛りは、年付きラベルとぶつかるので落とす。
 */
export function axisDateLabel(
  date: string,
  index: number,
  lastIndex: number,
  granularity: Granularity,
): string {
  if (index === 0 || index === lastIndex) {
    return formatChartDateLabel(date, granularity, true);
  }

  const interval = CHART_LABEL_INTERVAL[granularity];
  if (index % interval !== 0) return "";
  if (index < interval / 2 || lastIndex - index < interval / 2) return "";

  return formatChartDateLabel(date, granularity, false);
}

/** 全点を並べるのに要する幅。 */
export function chartScrollWidth(pointCount: number, granularity: Granularity): number {
  return pointCount * CHART_POINT_WIDTH[granularity];
}
