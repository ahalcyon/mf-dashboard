import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { CategoryAccordion } from "./category-accordion";

const meta = {
  title: "Info/CategoryBreakdown/CategoryAccordion",
  component: CategoryAccordion,
  tags: ["autodocs"],
  args: {
    onToggle: fn(),
    onToggleSubCategory: fn(),
    isSubCategoryExpanded: () => false,
  },
} satisfies Meta<typeof CategoryAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const food = {
  category: "食費",
  amount: 24000,
  subCategories: [
    {
      subCategory: "食料品",
      amount: 18000,
      transactions: [
        { date: "2026-07-03", description: "スーパー", amount: 4820 },
        { date: "2026-07-09", description: "コンビニ", amount: 780 },
      ],
    },
    {
      subCategory: "外食",
      amount: 6000,
      transactions: [{ date: "2026-07-18", description: "外食", amount: 6000 }],
    },
  ],
};

export const Collapsed: Story = {
  args: {
    item: food,
    total: 120000,
    type: "expense",
    hasPrevData: false,
    isExpanded: false,
  },
};

export const Expanded: Story = {
  args: {
    item: food,
    total: 120000,
    type: "expense",
    hasPrevData: false,
    isExpanded: true,
  },
};

/** 前月より増えた。増減は比較なので balance-negative 側になる。 */
export const IncreasedFromPrevMonth: Story = {
  args: {
    item: food,
    total: 120000,
    type: "expense",
    prevAmount: 18000,
    hasPrevData: true,
    isExpanded: false,
  },
};

/** 前月より減った。 */
export const DecreasedFromPrevMonth: Story = {
  args: {
    item: food,
    total: 120000,
    type: "expense",
    prevAmount: 31000,
    hasPrevData: true,
    isExpanded: false,
  },
};

/** 前月が 0 円。増減率を出せない場合の表示。 */
export const NoPrevAmount: Story = {
  args: {
    item: food,
    total: 120000,
    type: "expense",
    prevAmount: 0,
    hasPrevData: true,
    isExpanded: false,
  },
};

export const Income: Story = {
  args: {
    item: { category: "給与", amount: 320000, subCategories: [] },
    total: 480000,
    type: "income",
    hasPrevData: false,
    isExpanded: false,
  },
};

/** 小カテゴリが無いカテゴリ。開く操作が無意味にならないか。 */
export const WithoutSubCategories: Story = {
  args: {
    item: { category: "その他", amount: 5000 },
    total: 120000,
    type: "expense",
    hasPrevData: false,
    isExpanded: true,
  },
};
