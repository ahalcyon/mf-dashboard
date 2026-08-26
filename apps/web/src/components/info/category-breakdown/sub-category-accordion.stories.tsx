import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { SubCategoryAccordion } from "./sub-category-accordion";

const meta = {
  title: "Info/CategoryBreakdown/SubCategoryAccordion",
  component: SubCategoryAccordion,
  tags: ["autodocs"],
  args: { onToggle: fn() },
} satisfies Meta<typeof SubCategoryAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const transactions = [
  { date: "2026-07-03", description: "スーパー", amount: 4820 },
  { date: "2026-07-09", description: "コンビニ", amount: 780 },
  { date: "2026-07-18", description: "外食", amount: 3200 },
];

export const Collapsed: Story = {
  args: {
    subCategory: { subCategory: "食料品", amount: 8800, transactions },
    categoryAmount: 24000,
    type: "expense",
    isExpanded: false,
  },
};

export const Expanded: Story = {
  args: {
    subCategory: { subCategory: "食料品", amount: 8800, transactions },
    categoryAmount: 24000,
    type: "expense",
    isExpanded: true,
  },
};

export const Income: Story = {
  args: {
    subCategory: {
      subCategory: "賞与",
      amount: 480000,
      transactions: [{ date: "2026-07-10", description: "賞与", amount: 480000 }],
    },
    categoryAmount: 800000,
    type: "income",
    isExpanded: true,
  },
};

/** 明細が無い小カテゴリ。開いても空欄だけにならないか。 */
export const NoTransactions: Story = {
  args: {
    subCategory: { subCategory: "その他", amount: 1500, transactions: [] },
    categoryAmount: 24000,
    type: "expense",
    isExpanded: true,
  },
};

/**
 * 親カテゴリの合計が 0。割合の計算で 0 除算にならないことを見る
 * （実装は categoryAmount > 0 で守っている）。
 */
export const ZeroCategoryAmount: Story = {
  args: {
    subCategory: { subCategory: "未分類", amount: 0, transactions: [] },
    categoryAmount: 0,
    type: "expense",
    isExpanded: false,
  },
};
