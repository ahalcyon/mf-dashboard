import { describe, expect, it } from "vitest";
import { sumInvestmentHoldings } from "./investment-total";

const holding = (categoryName: string | null, amount: number | null) => ({
  categoryName,
  amount,
});

describe("sumInvestmentHoldings", () => {
  // 丸ごと落ちて初期投資額が過小になっていた。
  it("投資カテゴリをすべて合計する", () => {
    const total = sumInvestmentHoldings([
      holding("投資信託", 1_000_000),
      holding("株式(現物)", 500_000),
      holding("債券", 2_000_000),
      holding("暗号資産", 300_000),
      holding("年金", 700_000),
    ]);

    expect(total).toBe(4_500_000);
  });

  it("運用対象でない資産は除く", () => {
    const total = sumInvestmentHoldings([
      holding("投資信託", 1_000_000),
      holding("預金・現金", 3_000_000),
      holding("電子マネー・プリペイド", 5_000),
      holding("ポイント", 1_200),
      holding("ポイント・マイル", 800),
      holding("保険", 900_000),
    ]);

    expect(total).toBe(1_000_000);
  });

  // 負債（クレジットカード利用残高）はカテゴリを持たない。数えると初期値が壊れる。
  it("カテゴリが無い行は除く", () => {
    expect(sumInvestmentHoldings([holding(null, 250_000), holding("投資信託", 100)])).toBe(100);
  });

  it("評価額が無い行は 0 として扱う", () => {
    expect(sumInvestmentHoldings([holding("投資信託", null), holding("債券", 100)])).toBe(100);
  });

  it("保有が無ければ 0", () => {
    expect(sumInvestmentHoldings([])).toBe(0);
  });

  // 評価損で残高が負になることはあり得る。取り落とさない。
  it("負の評価額も合算する", () => {
    expect(sumInvestmentHoldings([holding("暗号資産", -50_000), holding("債券", 200_000)])).toBe(
      150_000,
    );
  });

  // 部分一致で拾っていた頃の名残を復活させない。
  it("カテゴリ名の部分一致では拾わない", () => {
    expect(sumInvestmentHoldings([holding("投資信託（特定口座）", 1_000_000)])).toBe(0);
  });
});
