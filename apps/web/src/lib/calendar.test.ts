import { describe, expect, it } from "vitest";
import {
  buildCalendarGrid,
  toDateString,
  parseDateString,
  parseMonthString,
  getIntensityLevel,
} from "./calendar";

describe("toDateString", () => {
  it("formats date with zero-padding", () => {
    expect(toDateString(2025, 4, 5)).toBe("2025-04-05");
    expect(toDateString(2025, 5, 25)).toBe("2025-05-25");
    expect(toDateString(2025, 4, 1)).toBe("2025-04-01");
  });
});

describe("parseDateString", () => {
  it("parses YYYY-MM-DD string", () => {
    expect(parseDateString("2025-04-15")).toEqual({ year: 2025, month: 4, day: 15 });
    expect(parseDateString("2025-05-25")).toEqual({ year: 2025, month: 5, day: 25 });
  });
});

describe("parseMonthString", () => {
  it("parses YYYY-MM string", () => {
    expect(parseMonthString("2025-04")).toEqual({ year: 2025, month: 4 });
    expect(parseMonthString("2025-05")).toEqual({ year: 2025, month: 5 });
  });
});

describe("getIntensityLevel", () => {
  it("returns 0 for zero amount", () => {
    expect(getIntensityLevel(0, 100)).toBe(0);
  });

  it("returns correct levels based on ratio", () => {
    const max = 100;
    expect(getIntensityLevel(10, max)).toBe(1); // 10% < 25%
    expect(getIntensityLevel(24, max)).toBe(1); // 24% < 25%
    expect(getIntensityLevel(25, max)).toBe(2); // 25% >= 25%, < 50%
    expect(getIntensityLevel(49, max)).toBe(2); // 49% < 50%
    expect(getIntensityLevel(50, max)).toBe(3); // 50% >= 50%, < 75%
    expect(getIntensityLevel(74, max)).toBe(3); // 74% < 75%
    expect(getIntensityLevel(75, max)).toBe(4); // 75% >= 75%
    expect(getIntensityLevel(100, max)).toBe(4); // 100%
  });

  it("handles max of 0 gracefully", () => {
    expect(getIntensityLevel(10, 0)).toBe(4);
  });
});

describe("buildCalendarGrid", () => {
  it("builds grid for April 2025 (starts on Tuesday)", () => {
    const grid = buildCalendarGrid(2025, 3, []);

    // April 2025 starts on Tuesday (dow=2), so 2 empty cells
    expect(grid[0].cells[0]).toBe(null);
    expect(grid[0].cells[1]).toBe(null);
    expect(grid[0].cells[2]).toEqual({ day: 1, date: "2025-04-01", amount: 0 });

    const allDays = grid.flatMap((w) => w.cells).filter((c) => c !== null);
    expect(allDays).toHaveLength(30);
  });

  it("builds grid for month starting on Sunday", () => {
    // June 2025 starts on Sunday (dow=0)
    const grid = buildCalendarGrid(2025, 5, []);

    expect(grid[0].cells[0]).toEqual({ day: 1, date: "2025-06-01", amount: 0 });
  });

  it("builds grid for month starting on Saturday", () => {
    // March 2025 starts on Saturday (dow=6)
    const grid = buildCalendarGrid(2025, 2, []);

    // 6 empty cells before day 1
    for (let i = 0; i < 6; i++) {
      expect(grid[0].cells[i]).toBe(null);
    }
    expect(grid[0].cells[6]).toEqual({ day: 1, date: "2025-03-01", amount: 0 });
  });

  it("includes daily data amounts", () => {
    const dailyData = [
      { date: "2025-04-15", amount: 5000 },
      { date: "2025-04-20", amount: 10000 },
    ];
    const grid = buildCalendarGrid(2025, 3, dailyData);

    const allCells = grid.flatMap((w) => w.cells).filter((c) => c !== null);
    const day15 = allCells.find((c) => c!.day === 15);
    const day20 = allCells.find((c) => c!.day === 20);
    const day10 = allCells.find((c) => c!.day === 10);

    expect(day15?.amount).toBe(5000);
    expect(day20?.amount).toBe(10000);
    expect(day10?.amount).toBe(0);
  });

  it("handles February in leap year", () => {
    // 2024 is a leap year
    const grid = buildCalendarGrid(2024, 1, []);
    const allDays = grid.flatMap((w) => w.cells).filter((c) => c !== null);
    expect(allDays).toHaveLength(29);
  });

  it("handles February in non-leap year", () => {
    // 2025 is not a leap year
    const grid = buildCalendarGrid(2025, 1, []);
    const allDays = grid.flatMap((w) => w.cells).filter((c) => c !== null);
    expect(allDays).toHaveLength(28);
  });

  it("fills trailing empty cells to complete last week", () => {
    // Every week should have exactly 7 cells
    const grid = buildCalendarGrid(2025, 3, []);
    for (const week of grid) {
      expect(week.cells).toHaveLength(7);
    }
  });
});
