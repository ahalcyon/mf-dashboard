import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { TransactionDesktopView } from "./transaction-desktop-view";
import type { Transaction } from "./types";

const meta = {
  title: "Info/TransactionTable/TransactionDesktopView",
  component: TransactionDesktopView,
  tags: ["autodocs"],
  args: { onSort: fn() },
} satisfies Meta<typeof TransactionDesktopView>;

export default meta;
type Story = StoryObj<typeof meta>;

const tx = (
  id: number,
  date: string,
  category: string | null,
  description: string,
  amount: number,
  type: string,
  accountName: string,
  isTransfer = false,
): Transaction => ({
  id,
  date,
  category,
  description,
  amount,
  type,
  isTransfer,
  isExcludedFromCalculation: false,
  accountName,
});

const transactions = [
  tx(1, "2026-07-01", "給与", "給与振込", 320000, "income", "Bank A"),
  tx(2, "2026-07-03", "食費", "スーパー", 4820, "expense", "Card A"),
  tx(3, "2026-07-05", "住宅", "家賃", 98000, "expense", "Bank A"),
  tx(4, "2026-07-09", null, "口座間振替", 50000, "transfer", "Bank B", true),
];

export const Default: Story = {
  args: {
    transactions,
    sortColumn: "date",
    sortDirection: "desc",
  },
};

/** 金額で昇順。並び替え中の列が見出しで分かるか。 */
export const SortedByAmount: Story = {
  args: {
    transactions,
    sortColumn: "amount",
    sortDirection: "asc",
  },
};

/** 計算対象外の取引。通常の行と区別が付くか。 */
export const ExcludedFromCalculation: Story = {
  args: {
    transactions: [
      { ...tx(1, "2026-07-02", "その他", "対象外の取引", 8000, "expense", "Card A") },
      {
        ...tx(2, "2026-07-04", "その他", "計算から除外", 12000, "expense", "Card A"),
        isExcludedFromCalculation: true,
      },
    ],
    sortColumn: "date",
    sortDirection: "desc",
  },
};

export const Empty: Story = {
  args: {
    transactions: [],
    sortColumn: "date",
    sortDirection: "desc",
  },
};
