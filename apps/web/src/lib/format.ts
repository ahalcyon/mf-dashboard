import {
  formatJstDateTimeForDisplay,
  parseIsoDateKey,
  parseYearMonthKey,
} from "@mf-dashboard/date-utils";

export function formatCurrency(amount: number, showPlusSign = false): string {
  const sign = showPlusSign && amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("ja-JP")}円`;
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("ja-JP").format(num);
}

/**
 * 軸ラベル向けに万・億で丸める。
 *
 * 億の分岐が無いと 2 億円の軸が "20000万" になり読めない。
 */
export function formatAxisAmount(value: number): string {
  if (Math.abs(value) >= 100_000_000) {
    const oku = Number((value / 100_000_000).toFixed(1));
    return `${oku.toLocaleString("ja-JP")}億`;
  }

  const man = Number((value / 10_000).toFixed(0));
  return `${man}万`;
}

export function formatPercent(value: number, decimals: number = 1): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

export function formatDate(dateStr: string): string {
  const { year, month, day } = parseIsoDateKey(dateStr);
  return `${year}年${month}月${day}日`;
}

export function formatMonth(monthStr: string): string {
  const { year, month } = parseYearMonthKey(monthStr);
  return `${year}年${month}月`;
}

export function getShortMonth(monthStr: string): string {
  const { month } = parseYearMonthKey(monthStr);
  return `${month}月`;
}

export function formatDateShort(dateStr: string): string {
  const { month, day } = parseIsoDateKey(dateStr);
  return `${month}月${day}日`;
}

export function formatDateTime(dateStr: string): string {
  return formatJstDateTimeForDisplay(new Date(dateStr), {
    includeYear: false,
    includeSeconds: false,
  });
}

export function formatTime(dateStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(dateStr));
}

export function formatElapsedTime(
  startedAt: string,
  finishedAt: string | null,
  now = Date.now(),
): string | null {
  const startTime = new Date(startedAt).getTime();
  const endTime = finishedAt ? new Date(finishedAt).getTime() : now;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;

  const totalSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatLastUpdated(lastUpdated: string | null, includeYear = false): string | null {
  if (!lastUpdated) return null;

  const localDateTime = lastUpdated.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (localDateTime) {
    const [, year, month, day, hours, minutes] = localDateTime;
    if (includeYear) {
      return `${Number(year)}/${Number(month)}/${Number(day)} ${hours}:${minutes}`;
    }
    return `${Number(month)}/${Number(day)} ${hours}:${minutes}`;
  }

  const date = new Date(lastUpdated);
  if (Number.isNaN(date.getTime())) return null;

  return formatJstDateTimeForDisplay(date, { includeYear, includeSeconds: false });
}
