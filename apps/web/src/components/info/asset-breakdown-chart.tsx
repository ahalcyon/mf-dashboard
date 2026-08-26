import {
  getAssetBreakdownByCategory,
  getCategoryChangesForPeriod,
  getLatestTotalAssets,
  getLiabilityBreakdownByCategory,
} from "@mf-dashboard/db";
import { PieChart } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { AssetBreakdownChartClient } from "./asset-breakdown-chart.client";

interface AssetBreakdownChartProps {
  className?: string;
  groupId?: string;
}

export async function AssetBreakdownChart({ className, groupId }: AssetBreakdownChartProps) {
  const data = await getAssetBreakdownByCategory(groupId);

  if (data.length === 0) {
    return <EmptyState icon={PieChart} title="資産構成" />;
  }

  // 互いに独立したクエリなので直列に待たない。
  const [totalAssets, liabilities, dailyChanges, weeklyChanges, monthlyChanges] = await Promise.all(
    [
      getLatestTotalAssets(groupId),
      getLiabilityBreakdownByCategory(groupId),
      getCategoryChangesForPeriod("daily", groupId),
      getCategoryChangesForPeriod("weekly", groupId),
      getCategoryChangesForPeriod("monthly", groupId),
    ],
  );
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);
  const netAssets = totalAssets !== null ? totalAssets - totalLiabilities : null;

  return (
    <AssetBreakdownChartClient
      data={data}
      dailyChanges={dailyChanges}
      weeklyChanges={weeklyChanges}
      monthlyChanges={monthlyChanges}
      netAssets={netAssets}
      className={className}
    />
  );
}
