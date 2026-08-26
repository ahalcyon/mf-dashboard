import { describe, test, expect } from "vitest";
import {
  INCOME_LARGE_CATEGORIES,
  EXPENSE_LARGE_CATEGORIES,
  ALL_LARGE_CATEGORIES,
  ASSET_CATEGORIES,
  INVESTMENT_ASSET_CATEGORIES,
  NON_INVESTMENT_ASSET_CATEGORIES,
  isInvestmentAssetCategory,
  LARGE_CATEGORY_NAME_BY_ID,
  LARGE_CATEGORY_ID_BY_NAME,
} from "./categories";

describe("INCOME_LARGE_CATEGORIES", () => {
  test("2つの収入カテゴリが定義されている", () => {
    expect(INCOME_LARGE_CATEGORIES).toHaveLength(2);
  });

  test("未分類(id=0)と収入(id=1)が含まれる", () => {
    expect(INCOME_LARGE_CATEGORIES[0]).toEqual({ id: 0, name: "未分類" });
    expect(INCOME_LARGE_CATEGORIES[1]).toEqual({ id: 1, name: "収入" });
  });
});

describe("EXPENSE_LARGE_CATEGORIES", () => {
  test("17個の支出カテゴリが定義されている", () => {
    expect(EXPENSE_LARGE_CATEGORIES).toHaveLength(17);
  });

  test("ID が一意", () => {
    const ids = EXPENSE_LARGE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(17);
  });

  test("食費(id=11)が含まれる", () => {
    const food = EXPENSE_LARGE_CATEGORIES.find((c) => c.id === 11);
    expect(food).toEqual({ id: 11, name: "食費" });
  });
});

describe("ALL_LARGE_CATEGORIES", () => {
  test("収入+支出の合計19個", () => {
    expect(ALL_LARGE_CATEGORIES).toHaveLength(19);
  });

  test("全IDが一意", () => {
    const ids = ALL_LARGE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(19);
  });
});

describe("LARGE_CATEGORY_NAME_BY_ID", () => {
  test("ID から名前を引ける", () => {
    expect(LARGE_CATEGORY_NAME_BY_ID[0]).toBe("未分類");
    expect(LARGE_CATEGORY_NAME_BY_ID[1]).toBe("収入");
    expect(LARGE_CATEGORY_NAME_BY_ID[11]).toBe("食費");
    expect(LARGE_CATEGORY_NAME_BY_ID[20]).toBe("交通費");
  });
});

describe("LARGE_CATEGORY_ID_BY_NAME", () => {
  test("名前から ID を引ける", () => {
    expect(LARGE_CATEGORY_ID_BY_NAME["未分類"]).toBe(0);
    expect(LARGE_CATEGORY_ID_BY_NAME["収入"]).toBe(1);
    expect(LARGE_CATEGORY_ID_BY_NAME["食費"]).toBe(11);
    expect(LARGE_CATEGORY_ID_BY_NAME["交通費"]).toBe(20);
  });
});

describe("資産カテゴリの投資判定", () => {
  // ここが要点。Money Forward が資産カテゴリを増やしたとき、どちらの一覧にも
  // 入っていなければこのテストが落ちる。放置すると新しいカテゴリが投資総額から
  // 黙って抜け落ちる。債券が丸ごと落ちていた #72 がまさにそれ。
  test("すべての資産カテゴリがどちらかに分類されている", () => {
    const classified = [...INVESTMENT_ASSET_CATEGORIES, ...NON_INVESTMENT_ASSET_CATEGORIES];

    expect([...classified].sort()).toEqual([...ASSET_CATEGORIES].sort());
  });

  test("同じカテゴリを両方に入れていない", () => {
    const overlap = INVESTMENT_ASSET_CATEGORIES.filter((name) =>
      (NON_INVESTMENT_ASSET_CATEGORIES as readonly string[]).includes(name),
    );

    expect(overlap).toEqual([]);
  });

  test.for(INVESTMENT_ASSET_CATEGORIES)("%s は投資に含める", (name) => {
    expect(isInvestmentAssetCategory(name)).toBe(true);
  });

  test.for(NON_INVESTMENT_ASSET_CATEGORIES)("%s は投資に含めない", (name) => {
    expect(isInvestmentAssetCategory(name)).toBe(false);
  });

  // 負債はカテゴリを持たない。null を投資として数えると初期値が壊れる。
  test("カテゴリが無いものは投資に含めない", () => {
    expect(isInvestmentAssetCategory(null)).toBe(false);
    expect(isInvestmentAssetCategory(undefined)).toBe(false);
    expect(isInvestmentAssetCategory("")).toBe(false);
  });

  // 以前は categoryName.includes("投資信託") で判定していた。部分一致だと
  // 「投資信託」を含む別名も拾うし、「株式(現物)」は拾えない。
  test("部分一致では判定しない", () => {
    expect(isInvestmentAssetCategory("投資信託（特定口座）")).toBe(false);
    expect(isInvestmentAssetCategory("投資")).toBe(false);
  });
});
