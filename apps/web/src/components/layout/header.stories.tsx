import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { SidebarProvider } from "../../contexts/sidebar-context";
import { AccountNotificationsClient } from "../info/account-notifications.client";
import { DEFAULT_NOTIFICATIONS_KEY, Header } from "./header";

const mockGroups = [
  { id: "1", name: "個人資産", isCurrent: true, lastScrapedAt: "2025-04-30T10:30:00" },
  { id: "2", name: "家族", isCurrent: false, lastScrapedAt: "2025-04-30T15:20:00" },
];

const meta = {
  title: "Layout/Header",
  component: Header,
  tags: ["autodocs"],
  decorators: [
    (Story: () => ReactNode) => (
      <SidebarProvider>
        <Story />
      </SidebarProvider>
    ),
  ],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/",
      },
    },
  },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    groups: mockGroups,
    defaultGroupId: "1",
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[]}
          updatingAccounts={[]}
          balanceAlerts={[]}
          totalIssues={0}
        />
      ),
    },
  },
};

export const SingleGroup: Story = {
  args: {
    groups: [mockGroups[0]],
    defaultGroupId: "1",
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[]}
          updatingAccounts={[]}
          balanceAlerts={[]}
          totalIssues={0}
        />
      ),
    },
  },
};

export const OnlyNoGroupPseudoGroup: Story = {
  args: {
    groups: [{ id: "0", name: "グループ選択なし", isCurrent: true, lastScrapedAt: null }],
    defaultGroupId: "0",
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[]}
          updatingAccounts={[]}
          balanceAlerts={[]}
          totalIssues={0}
        />
      ),
    },
  },
};

export const NoGroup: Story = {
  args: {
    groups: [],
    defaultGroupId: null,
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[]}
          updatingAccounts={[]}
          balanceAlerts={[]}
          totalIssues={0}
        />
      ),
    },
  },
};

export const WithNotifications: Story = {
  args: {
    groups: mockGroups,
    defaultGroupId: "1",
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[{ id: 1, mfId: "account-1", name: "User Aの銀行口座", status: "error" }]}
          updatingAccounts={[
            { id: 2, mfId: "account-2", name: "User Bの証券口座", status: "updating" },
          ]}
          balanceAlerts={[]}
          totalIssues={2}
        />
      ),
    },
  },
};

// URL のグループに対応する通知が選ばれることを見せる。pathname を /2 にすると
// 既定グループ側（0 件）ではなくグループ 2 側（2 件）のベルが出る。
export const GroupNotifications: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/2" },
    },
  },
  args: {
    groups: mockGroups,
    defaultGroupId: "1",
    notifications: {
      [DEFAULT_NOTIFICATIONS_KEY]: (
        <AccountNotificationsClient
          errorAccounts={[]}
          updatingAccounts={[]}
          balanceAlerts={[]}
          totalIssues={0}
        />
      ),
      "2": (
        <AccountNotificationsClient
          errorAccounts={[{ id: 3, mfId: "account-3", name: "Group Bの銀行口座", status: "error" }]}
          updatingAccounts={[
            { id: 4, mfId: "account-4", name: "Group Bの証券口座", status: "updating" },
          ]}
          balanceAlerts={[]}
          totalIssues={2}
        />
      ),
    },
  },
};
