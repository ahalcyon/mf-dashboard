import { describe, expect, it } from "vitest";
import {
  roundToNice,
  getCutoffDate,
  filterDataByPeriod,
  collapseToMonthly,
  resampleByGranularity,
  formatChartDateLabel,
  axisDateLabel,
  chartYearMarkers,
  chartScrollWidth,
} from "./chart";

describe("roundToNice", () => {
  it("returns minimum value for zero or negative", () => {
    expect(roundToNice(0)).toBe(100000);
    expect(roundToNice(-100)).toBe(100000);
  });

  it("rounds small values correctly", () => {
    expect(roundToNice(1)).toBe(1);
    expect(roundToNice(1.1)).toBe(1.2);
    expect(roundToNice(1.3)).toBe(1.5);
    expect(roundToNice(1.8)).toBe(2);
    expect(roundToNice(2.3)).toBe(2.5);
    expect(roundToNice(2.8)).toBe(3);
  });

  it("handles different magnitudes", () => {
    expect(roundToNice(85)).toBe(100); // 8.5 -> 10 -> 100
    expect(roundToNice(850)).toBe(1000);
    expect(roundToNice(8500)).toBe(10000);

    expect(roundToNice(120)).toBe(120); // 1.2 -> 1.2 -> 120
    expect(roundToNice(150)).toBe(150);
    expect(roundToNice(180)).toBe(200);
  });

  it("handles realistic income/expense values", () => {
    expect(roundToNice(250000)).toBe(250000); // 25万 -> 2.5 * 100000
    expect(roundToNice(380000)).toBe(400000); // 38万 -> 4 * 100000
    expect(roundToNice(1200000)).toBe(1200000); // 120万 -> 1.2 * 1000000
    expect(roundToNice(1800000)).toBe(2000000); // 180万 -> 2 * 1000000
  });
});

describe("getCutoffDate", () => {
  const now = new Date(2025, 4, 15); // May 15, 2025

  it("returns null for all period", () => {
    expect(getCutoffDate("all", now)).toBe(null);
  });

  it("calculates 1 month ago", () => {
    const cutoff = getCutoffDate("1m", now);
    expect(cutoff?.getFullYear()).toBe(2025);
    expect(cutoff?.getMonth()).toBe(3); // April
    expect(cutoff?.getDate()).toBe(15);
  });

  it("calculates 3 months ago", () => {
    const cutoff = getCutoffDate("3m", now);
    expect(cutoff?.getFullYear()).toBe(2025);
    expect(cutoff?.getMonth()).toBe(1); // February
  });

  it("calculates 6 months ago", () => {
    const cutoff = getCutoffDate("6m", now);
    // JS Date automatically wraps: May - 6 = November of previous year
    expect(cutoff?.getMonth()).toBe(10); // November
    expect(cutoff?.getFullYear()).toBe(2024);
  });

  it("calculates 1 year ago", () => {
    const cutoff = getCutoffDate("1y", now);
    expect(cutoff?.getFullYear()).toBe(2024);
    expect(cutoff?.getMonth()).toBe(4); // May
  });
});

describe("filterDataByPeriod", () => {
  const testData = [
    { date: "2024-12-15", value: 100 },
    { date: "2024-12-20", value: 110 },
    { date: "2025-01-10", value: 120 },
    { date: "2025-01-28", value: 130 },
    { date: "2025-02-15", value: 140 },
    { date: "2025-03-10", value: 150 },
    { date: "2025-04-20", value: 160 },
    { date: "2025-05-10", value: 170 },
  ];

  const now = new Date(2025, 4, 15); // May 15, 2025

  it("returns every point for 'all' period", () => {
    const result = filterDataByPeriod(testData, "all", now);
    expect(result).toEqual(testData);
  });

  it("filters by 1 month and keeps all days", () => {
    const result = filterDataByPeriod(testData, "1m", now);
    expect(result.every((d) => new Date(d.date) >= new Date(2025, 3, 15))).toBe(true);
  });

  it("keeps every day inside the cutoff for longer periods", () => {
    const result = filterDataByPeriod(testData, "3m", now);
    expect(result.map((d) => d.date)).toEqual([
      "2025-02-15",
      "2025-03-10",
      "2025-04-20",
      "2025-05-10",
    ]);
  });

  it("handles empty data", () => {
    const result = filterDataByPeriod([], "3m", now);
    expect(result).toHaveLength(0);
  });

  it("preserves data structure", () => {
    const dataWithExtra = [
      { date: "2025-05-01", value: 100, extra: "data" },
      { date: "2025-05-10", value: 110, extra: "more" },
    ];
    const result = filterDataByPeriod(dataWithExtra, "1m", now);
    expect(result[0]).toHaveProperty("extra");
  });
});

describe("collapseToMonthly", () => {
  it("keeps the last point of each month in ascending order", () => {
    const result = collapseToMonthly([
      { date: "2025-01-28", value: 130 },
      { date: "2024-12-15", value: 100 },
      { date: "2025-01-10", value: 120 },
      { date: "2024-12-20", value: 110 },
    ]);

    expect(result).toEqual([
      { date: "2024-12-20", value: 110 },
      { date: "2025-01-28", value: 130 },
    ]);
  });

  it("handles empty data", () => {
    expect(collapseToMonthly([])).toEqual([]);
  });
});

describe("resampleByGranularity", () => {
  const data = [
    { date: "2025-01-10", value: 1 },
    { date: "2025-01-28", value: 2 },
  ];

  it("returns every point for daily", () => {
    expect(resampleByGranularity(data, "daily")).toEqual(data);
  });

  it("collapses to the last point of the month for monthly", () => {
    expect(resampleByGranularity(data, "monthly")).toEqual([{ date: "2025-01-28", value: 2 }]);
  });
});

describe("formatChartDateLabel", () => {
  it.each([
    { granularity: "daily" as const, expected: "09/04" },
    { granularity: "monthly" as const, expected: "09" },
  ])("$granularity -> $expected", ({ granularity, expected }) => {
    expect(formatChartDateLabel("2026-09-04", granularity)).toBe(expected);
  });
});

describe("chartYearMarkers", () => {
  it("年をまたぐときだけ両端の年を返す", () => {
    expect(chartYearMarkers(["2025-11-01", "2026-01-15", "2026-03-01"])).toEqual({
      start: "2025",
      end: "2026",
    });
  });

  it("同じ年に収まるならnullを返す", () => {
    expect(chartYearMarkers(["2026-01-15", "2026-03-01"])).toBeNull();
  });

  it("1点でもその年に収まるのでnullを返す", () => {
    expect(chartYearMarkers(["2026-01-15"])).toBeNull();
  });

  it("空ならnullを返す", () => {
    expect(chartYearMarkers([])).toBeNull();
  });
});

describe("axisDateLabel", () => {
  const daily = (index: number, lastIndex: number) =>
    axisDateLabel("2026-06-07", index, lastIndex, "daily");

  it("両端は必ずラベルを出す", () => {
    expect(daily(0, 30)).toBe("06/07");
    expect(daily(30, 30)).toBe("06/07");
  });

  it("日次は1週間おきにだけラベルを出す", () => {
    expect(daily(7, 30)).toBe("06/07");
    expect(daily(14, 30)).toBe("06/07");
    expect(daily(1, 30)).toBe("");
    expect(daily(6, 30)).toBe("");
    expect(daily(13, 30)).toBe("");
  });

  it("両端に寄りすぎた目盛りは落とす", () => {
    expect(daily(28, 30)).toBe("");
    expect(daily(28, 40)).toBe("06/07");
  });

  it("月次は毎月ラベルを出す", () => {
    expect(axisDateLabel("2026-06-30", 1, 5, "monthly")).toBe("06");
    expect(axisDateLabel("2026-06-30", 2, 5, "monthly")).toBe("06");
    expect(axisDateLabel("2026-06-30", 0, 5, "monthly")).toBe("06");
  });

  it("点が1つだけでもラベルを出す", () => {
    expect(daily(0, 0)).toBe("06/07");
  });
});

describe("chartScrollWidth", () => {
  it("grows with the number of points", () => {
    expect(chartScrollWidth(0, "daily")).toBe(0);
    expect(chartScrollWidth(180, "daily")).toBe(180 * 10);
    expect(chartScrollWidth(24, "monthly")).toBe(24 * 40);
  });

  it("gives a monthly point more room than a daily one", () => {
    expect(chartScrollWidth(1, "monthly")).toBeGreaterThan(chartScrollWidth(1, "daily"));
  });
});
