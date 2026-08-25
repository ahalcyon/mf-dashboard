import type { AssetSummary, AssetItem, CashFlowSummary } from "@mf-dashboard/db/types";

interface AccountIssue {
  name: string;
  status: "updating" | "error";
  errorMessage?: string;
}

/**
 * 通知（メール）へ載せる 1 グループ分のペイロード。
 * 永続化用の `ScrapedData`（@mf-dashboard/db/types）とは別物。
 */
export interface NotificationPayload {
  summary: AssetSummary;
  items: AssetItem[];
  updatedAt: string;
  groupName?: string;
  accountIssues?: AccountIssue[];
}

export interface ScrapeOptions {
  skipRefresh?: boolean;
}

export interface CashFlowHistoryResult {
  month: string;
  progressMonth?: string;
  data: CashFlowSummary;
}
