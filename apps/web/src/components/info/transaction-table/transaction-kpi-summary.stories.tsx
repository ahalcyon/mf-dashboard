import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TransactionKpiSummary } from "./transaction-kpi-summary";

/**
 * 金額の色分けを扱う面なのに視覚的な検証が無かった。収支は符号で
 * balance-positive / balance-negative が入れ替わるので、両方を出しておく。
 */
const meta = {
  title: "Info/TransactionTable/TransactionKpiSummary",
  component: TransactionKpiSummary,
  tags: ["autodocs"],
} satisfies Meta<typeof TransactionKpiSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Surplus: Story = {
  args: {
    kpi: {
      totalIncome: 480000,
      totalExpense: 312500,
      balance: 167500,
      count: 42,
      medianExpense: 3200,
    },
  },
};

export const Deficit: Story = {
  args: {
    kpi: {
      totalIncome: 280000,
      totalExpense: 415000,
      balance: -135000,
      count: 51,
      medianExpense: 4800,
    },
  },
};

/** 収支ちょうど 0。正負どちらの色にも寄らない状態。 */
export const Balanced: Story = {
  args: {
    kpi: {
      totalIncome: 300000,
      totalExpense: 300000,
      balance: 0,
      count: 30,
      medianExpense: 2500,
    },
  },
};

/** 取引が無い月。桁区切りや単位が 0 でも崩れないことを見る。 */
export const NoTransactions: Story = {
  args: {
    kpi: {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      count: 0,
      medianExpense: 0,
    },
  },
};

/** 桁が伸びたときに 2 列レイアウトで折り返さないか。 */
export const LargeAmounts: Story = {
  args: {
    kpi: {
      totalIncome: 12345678,
      totalExpense: 9876543,
      balance: 2469135,
      count: 320,
      medianExpense: 18400,
    },
  },
};
