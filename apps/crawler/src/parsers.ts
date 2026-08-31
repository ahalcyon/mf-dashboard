import { convertToIsoDate } from "@mf-dashboard/db/utils";

export function parseJapaneseNumber(str: string): number {
  if (!str) return 0;

  const isNegative = str.includes("-") || str.includes("−") || str.includes("▲");

  let total = 0;
  let remaining = str.replace(/[¥,$,\s円+\-−▲]/g, "");

  const okuMatch = remaining.match(/(\d+(?:\.\d+)?)億/);
  if (okuMatch) {
    total += parseFloat(okuMatch[1]) * 100000000;
    remaining = remaining.replace(/\d+(?:\.\d+)?億/, "");
  }

  const manMatch = remaining.match(/(\d+(?:\.\d+)?)万/);
  if (manMatch) {
    total += parseFloat(manMatch[1]) * 10000;
    remaining = remaining.replace(/\d+(?:\.\d+)?万/, "");
  }

  // If we found 億 or 万, return the total
  if (okuMatch || manMatch) {
    const remainingNum = parseInt(remaining.replace(/\D/g, ""), 10);
    if (Number.isFinite(remainingNum)) {
      total += remainingNum;
    }
    const rounded = Math.round(total);
    return isNegative ? -rounded : rounded;
  }

  // No 億/万 units - parse as plain number
  const cleaned = str.replace(/[¥,$\s円+\-−▲]/g, "");
  const value = parseInt(cleaned, 10);
  return Number.isFinite(value) ? (isNegative ? -value : value) : 0;
}

export function parseDecimalNumber(str: string): number {
  if (!str) return 0;
  const isNegative = str.includes("-") || str.includes("−") || str.includes("▲");
  const cleaned = str.replace(/[¥,$\s円+\-−▲]/g, "");
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? (isNegative ? -value : value) : 0;
}

export function parsePercentage(str: string): number | undefined {
  if (!str) return undefined;
  const isNegative = str.includes("-") || str.includes("−") || str.includes("▲");
  const cleaned = str.replace(/[%％\s+\-−▲]/g, "");
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) return undefined;
  return isNegative ? -value : value;
}

export function calculateChange(current: string, previous: string): string {
  const currentNum = parseJapaneseNumber(current);
  const previousNum = parseJapaneseNumber(previous);

  const diff = currentNum - previousNum;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}¥${diff.toLocaleString()}`;
}

export function convertDateToIso(dateStr: string, year: number): string {
  let iso: string;
  try {
    iso = convertToIsoDate(dateStr, year);
  } catch {
    // 共有側は "02/30" のような日付を例外にするが、ここでは素通しする。
    // cash flow の行は「日付を取れない行がある」ことを行単位の文脈付き
    // エラーとして報告する必要があり、その判断は呼び出し側にある。
    return dateStr;
  }

  // 文字列比較で行っており、"2025-04-30T08:51:00" は "2025-04-30" より
  // 大きいと判定される。時刻を残すと期間末日のセルが範囲外に落ちる。
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : iso;
}
