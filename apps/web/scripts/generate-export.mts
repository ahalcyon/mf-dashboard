/**
 * 資産データを静的ファイルとして public/export/ に書き出す。
 *
 * next build の前に実行し、出力を静的エクスポートへそのまま同梱する。
 * LLM へ食わせて分析するのが用途なので、サーバーを介さずファイル単体で完結させる。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeDb,
  getAccountsWithAssets,
  getAllGroups,
  getAssetBreakdownByCategory,
  getAssetHistoryWithCategories,
  getCurrentGroup,
  getHoldingsWithLatestValues,
  getLiabilityBreakdownByCategory,
  isDatabaseAvailable,
} from "@mf-dashboard/db";

const OUTPUT_DIRECTORY = path.join(import.meta.dirname, "../public/export");

interface AssetExport {
  generatedAt: string;
  group: { id: string; name: string };
  summary: {
    latestDate: string | null;
    totalAssets: number | null;
    totalLiabilities: number;
    netAssets: number | null;
    dayOverDayChange: number | null;
  };
  dailyTotals: Array<{ date: string; totalAssets: number; categories: Record<string, number> }>;
  assetBreakdown: Array<{ category: string; amount: number }>;
  liabilityBreakdown: Array<{ category: string; amount: number }>;
  accounts: Array<{
    name: string;
    type: string | null;
    category: string | null;
    totalAssets: number | null;
    status: string | null;
    lastUpdated: string | null;
  }>;
  holdings: Array<{
    name: string;
    type: string;
    category: string | null;
    account: string | null;
    institution: string | null;
    quantity: number | null;
    unitPrice: number | null;
    avgCostPrice: number | null;
    amount: number | null;
    unrealizedGain: number | null;
    unrealizedGainPct: number | null;
    dailyChange: number | null;
  }>;
}

async function buildExport(group: { id: string; name: string }): Promise<AssetExport> {
  const [history, assetBreakdown, liabilityBreakdown, accounts, holdings] = await Promise.all([
    getAssetHistoryWithCategories({ groupId: group.id }),
    getAssetBreakdownByCategory(group.id),
    getLiabilityBreakdownByCategory(group.id),
    getAccountsWithAssets(group.id),
    getHoldingsWithLatestValues(group.id),
  ]);

  // getAssetHistoryWithCategories は日付の降順で返すため、時系列として扱いやすい昇順へ直す
  const dailyTotals = [...history].reverse();
  const latest = dailyTotals.at(-1) ?? null;
  const previous = dailyTotals.at(-2) ?? null;
  const totalLiabilities = liabilityBreakdown.reduce((sum, item) => sum + item.amount, 0);

  return {
    generatedAt: new Date().toISOString(),
    group,
    summary: {
      latestDate: latest?.date ?? null,
      totalAssets: latest?.totalAssets ?? null,
      totalLiabilities,
      netAssets: latest ? latest.totalAssets - totalLiabilities : null,
      dayOverDayChange: latest && previous ? latest.totalAssets - previous.totalAssets : null,
    },
    dailyTotals,
    assetBreakdown,
    liabilityBreakdown,
    accounts: accounts.map((account) => ({
      name: account.name,
      type: account.type ?? null,
      category: account.categoryName ?? null,
      totalAssets: account.totalAssets ?? null,
      status: account.status ?? null,
      lastUpdated: account.lastUpdated ?? null,
    })),
    holdings: holdings.map((holding) => ({
      name: holding.name,
      type: holding.type,
      category: holding.categoryName ?? null,
      account: holding.accountName ?? null,
      institution: holding.institution ?? null,
      quantity: holding.quantity ?? null,
      unitPrice: holding.unitPrice ?? null,
      avgCostPrice: holding.avgCostPrice ?? null,
      amount: holding.amount ?? null,
      unrealizedGain: holding.unrealizedGain ?? null,
      unrealizedGainPct: holding.unrealizedGainPct ?? null,
      dailyChange: holding.dailyChange ?? null,
    })),
  };
}

function formatYen(value: number | null): string {
  return value === null ? "-" : `${value.toLocaleString("ja-JP")} 円`;
}

function markdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "データなし\n";
  const alignment = headers.map(() => "---");
  return [headers, alignment, ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n") + "\n";
}

function toMarkdown(data: AssetExport): string {
  const categoryNames = [
    ...new Set(data.dailyTotals.flatMap((entry) => Object.keys(entry.categories))),
  ].sort();

  return `# 資産エクスポート: ${data.group.name}

生成日時: ${data.generatedAt}
基準日: ${data.summary.latestDate ?? "-"}

## サマリー

| 項目 | 金額 |
| --- | --- |
| 総資産 | ${formatYen(data.summary.totalAssets)} |
| 負債 | ${formatYen(data.summary.totalLiabilities)} |
| 純資産 | ${formatYen(data.summary.netAssets)} |
| 前日比 | ${formatYen(data.summary.dayOverDayChange)} |

## 日次の資産総額 (${data.dailyTotals.length} 日分, 昇順)

${markdownTable(
  ["日付", "総資産", ...categoryNames],
  data.dailyTotals.map((entry) => [
    entry.date,
    String(entry.totalAssets),
    ...categoryNames.map((name) => String(entry.categories[name] ?? 0)),
  ]),
)}
## 資産カテゴリ別内訳

${markdownTable(
  ["カテゴリ", "金額"],
  data.assetBreakdown.map((item) => [item.category, String(item.amount)]),
)}
## 負債カテゴリ別内訳

${markdownTable(
  ["カテゴリ", "金額"],
  data.liabilityBreakdown.map((item) => [item.category, String(item.amount)]),
)}
## 口座

${markdownTable(
  ["名称", "種別", "カテゴリ", "残高", "状態", "最終更新"],
  data.accounts.map((account) => [
    account.name,
    account.type ?? "-",
    account.category ?? "-",
    String(account.totalAssets ?? "-"),
    account.status ?? "-",
    account.lastUpdated ?? "-",
  ]),
)}
## 保有銘柄

${markdownTable(
  ["名称", "種別", "カテゴリ", "口座", "数量", "取得単価", "評価額", "評価損益", "評価損益率"],
  data.holdings.map((holding) => [
    holding.name,
    holding.type,
    holding.category ?? "-",
    holding.account ?? "-",
    String(holding.quantity ?? "-"),
    String(holding.avgCostPrice ?? "-"),
    String(holding.amount ?? "-"),
    String(holding.unrealizedGain ?? "-"),
    String(holding.unrealizedGainPct ?? "-"),
  ]),
)}
金額の単位は円。日次の資産総額はカテゴリ別の内訳を併記している。
`;
}

async function writeExport(directory: string, data: AssetExport): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "assets.json"), `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(path.join(directory, "assets.md"), toMarkdown(data));
}

async function main(): Promise<void> {
  await rm(OUTPUT_DIRECTORY, { force: true, recursive: true });

  if (!isDatabaseAvailable()) {
    console.warn("[export] データベースが見つからないため、エクスポートを生成しませんでした。");
    return;
  }

  const groups = await getAllGroups();
  if (groups.length === 0) {
    console.warn("[export] グループが存在しないため、エクスポートを生成しませんでした。");
    return;
  }

  const currentGroup = await getCurrentGroup();
  const defaultGroupId = currentGroup?.id ?? groups[0]?.id;

  for (const group of groups) {
    const data = await buildExport({ id: group.id, name: group.name });
    await writeExport(path.join(OUTPUT_DIRECTORY, group.id), data);

    // 既定グループはグループIDなしのパスからも取得できるようにする
    if (group.id === defaultGroupId) {
      await writeExport(OUTPUT_DIRECTORY, data);
    }
    console.info(`[export] ${group.name}: ${data.dailyTotals.length} 日分を書き出しました`);
  }
}

try {
  await main();
} finally {
  closeDb();
}
