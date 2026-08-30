import { isInvestmentAssetCategory } from "@mf-dashboard/meta/categories";

/** 合計に必要な最小限だけを受け取る。呼び出し側の行の型に縛られないようにする。 */
interface HoldingLike {
  categoryName: string | null;
  amount: number | null;
}

/**
 * 投資として運用されている資産の評価額合計。
 *
 * シミュレーターの初期投資額に使う。
 *
 * 負債はカテゴリを持たないので `isInvestmentAssetCategory` が弾く。
 */
export function sumInvestmentHoldings(holdings: readonly HoldingLike[]): number {
  return holdings
    .filter((holding) => isInvestmentAssetCategory(holding.categoryName))
    .reduce((total, holding) => total + (holding.amount ?? 0), 0);
}
