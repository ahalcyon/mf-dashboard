import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AccountNotificationsClient } from "./account-notifications.client";

const meta = {
  title: "Info/AccountNotifications",
  component: AccountNotificationsClient,
  tags: ["autodocs"],
} satisfies Meta<typeof AccountNotificationsClient>;

export default meta;
type Story = StoryObj<typeof meta>;

const account = (id: number, name: string, status: string) => ({
  id,
  mfId: `mf-${id}`,
  name,
  status,
});

/** 問題なし。ベルにバッジが付かない状態。 */
export const NoIssues: Story = {
  args: {
    errorAccounts: [],
    updatingAccounts: [],
    balanceAlerts: [],
    totalIssues: 0,
  },
};

export const ErrorAccounts: Story = {
  args: {
    errorAccounts: [account(1, "Bank A", "error"), account(2, "Card A", "error")],
    updatingAccounts: [],
    balanceAlerts: [],
    totalIssues: 2,
  },
};

export const Updating: Story = {
  args: {
    errorAccounts: [],
    updatingAccounts: [account(3, "Bank B", "updating")],
    balanceAlerts: [],
    totalIssues: 1,
  },
};

export const BalanceAlerts: Story = {
  args: {
    errorAccounts: [],
    updatingAccounts: [],
    balanceAlerts: [
      { accountId: 4, accountName: "Bank A", forecastBalance: -32000 },
      { accountId: 5, accountName: "Bank B", forecastBalance: -1200 },
    ],
    totalIssues: 2,
  },
};

/** 3 種類が同時に出る。区切りが分かるか。 */
export const AllKinds: Story = {
  args: {
    errorAccounts: [account(1, "Bank A", "error")],
    updatingAccounts: [account(3, "Bank B", "updating")],
    balanceAlerts: [{ accountId: 4, accountName: "Card A", forecastBalance: -8400 }],
    totalIssues: 3,
  },
};

/** 件数が 2 桁になったときにバッジが崩れないか。 */
export const ManyIssues: Story = {
  args: {
    errorAccounts: Array.from({ length: 12 }, (_, i) => account(i + 1, `Bank ${i + 1}`, "error")),
    updatingAccounts: [],
    balanceAlerts: [],
    totalIssues: 12,
  },
};
