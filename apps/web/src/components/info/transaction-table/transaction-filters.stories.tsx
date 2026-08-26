import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { TransactionFilters } from "./transaction-filters";

const categories = ["食費", "住宅", "水道・光熱費", "交通費", "給与"];
const accounts = ["Bank A", "Bank B", "Card A"];

const meta = {
  title: "Info/TransactionTable/TransactionFilters",
  component: TransactionFilters,
  tags: ["autodocs"],
  args: {
    categories,
    accounts,
    typeOptions: ["income", "expense", "transfer"],
    categoryCount: new Map(categories.map((name, i) => [name, (i + 1) * 3])),
    accountCount: new Map(accounts.map((name, i) => [name, (i + 1) * 7])),
    onSearchChange: fn(),
    onCategoriesChange: fn(),
    onTypesChange: fn(),
    onAccountsChange: fn(),
    onRemoveCategory: fn(),
    onRemoveType: fn(),
    onRemoveAccount: fn(),
    onRemoveDate: fn(),
    onClearAll: fn(),
  },
} satisfies Meta<typeof TransactionFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    searchText: "",
    selectedCategories: [],
    selectedTypes: [],
    selectedAccounts: [],
    selectedDate: null,
    transactionCount: 128,
  },
};

/** 絞り込みが効いている状態。解除できることが分かるか。 */
export const Active: Story = {
  args: {
    searchText: "スーパー",
    selectedCategories: ["食費", "住宅"],
    selectedTypes: ["expense"],
    selectedAccounts: ["Card A"],
    selectedDate: "2026-07-05",
    transactionCount: 6,
  },
};

/** 絞り込んだ結果 0 件。件数表示が破綻しないか。 */
export const NoMatches: Story = {
  args: {
    searchText: "該当なし",
    selectedCategories: ["交通費"],
    selectedTypes: [],
    selectedAccounts: [],
    selectedDate: null,
    transactionCount: 0,
  },
};

/** 選択が多いときにチップが折り返す。 */
export const ManySelections: Story = {
  args: {
    searchText: "",
    selectedCategories: categories,
    selectedTypes: ["income", "expense", "transfer"],
    selectedAccounts: accounts,
    selectedDate: "2026-07-20",
    transactionCount: 12,
  },
};
