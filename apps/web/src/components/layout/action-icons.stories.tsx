import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { AccountNotificationsClient } from "../info/account-notifications.client";
import { ActionIcons } from "./action-icons";

/** クロール起動の応答を差し替える。フックの後片付けは Storybook が行う。 */
function mockRefreshResponse(status: number) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ status }), { status }))) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

const meta = {
  title: "Layout/ActionIcons",
  component: ActionIcons,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/",
      },
    },
  },
} satisfies Meta<typeof ActionIcons>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Header: Story = {
  args: {
    variant: "header",
    notifications: (
      <AccountNotificationsClient
        errorAccounts={[]}
        updatingAccounts={[]}
        balanceAlerts={[]}
        totalIssues={0}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "ヘルプ" }));

    const dialog = within(within(canvasElement.ownerDocument.body).getByRole("dialog"));
    await expect(dialog.getByText("資産データのエクスポート")).toBeInTheDocument();
  },
};

export const HeaderWithNotifications: Story = {
  args: {
    variant: "header",
    notifications: (
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
};

export const RefreshStarted: Story = {
  args: { variant: "header" },
  play: async ({ canvasElement }) => {
    const restore = mockRefreshResponse(202);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "金融機関データを更新" }));

      await userEvent.click(await screen.findByRole("button", { name: "更新を開始" }));

      await waitFor(async () => {
        await expect(
          screen.getByRole("heading", { name: "更新を開始しました" }),
        ).toBeInTheDocument();
      });
    } finally {
      restore();
    }
  },
};

export const RefreshAlreadyRunning: Story = {
  args: { variant: "header" },
  play: async ({ canvasElement }) => {
    const restore = mockRefreshResponse(409);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "金融機関データを更新" }));
      await userEvent.click(await screen.findByRole("button", { name: "更新を開始" }));

      await waitFor(async () => {
        await expect(screen.getByRole("heading", { name: "すでに更新中です" })).toBeInTheDocument();
      });
    } finally {
      restore();
    }
  },
};

export const RefreshSessionExpired: Story = {
  args: { variant: "header" },
  play: async ({ canvasElement }) => {
    const restore = mockRefreshResponse(401);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "金融機関データを更新" }));
      await userEvent.click(await screen.findByRole("button", { name: "更新を開始" }));

      await waitFor(async () => {
        await expect(
          screen.getByRole("heading", { name: "認証の期限が切れました" }),
        ).toBeInTheDocument();
      });
      await expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
    } finally {
      restore();
    }
  },
};

/** 押しただけではクロールを起動せず、まず確認を出す。 */
export const RefreshConfirmation: Story = {
  args: { variant: "header" },
  play: async ({ canvasElement }) => {
    const restore = mockRefreshResponse(202);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "金融機関データを更新" }));

      await expect(
        await screen.findByRole("heading", { name: "金融機関データを更新しますか" }),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  },
};

export const Sidebar: Story = {
  args: { variant: "sidebar" },
};
