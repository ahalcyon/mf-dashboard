import { getAllGroups, getCurrentGroup, isDatabaseAvailable } from "@mf-dashboard/db";
import { DatabaseZap } from "lucide-react";
import "./globals.css";
import type { ReactNode } from "react";
import { AccountNotifications } from "../components/info/account-notifications";
import { DEFAULT_NOTIFICATIONS_KEY, Header } from "../components/layout/header";
import { Sidebar } from "../components/layout/sidebar";
import { SidebarProvider } from "../contexts/sidebar-context";
import { createRootMetadata } from "../lib/metadata";
import { waitForRuntimeData } from "../lib/runtime-rendering";

export const metadata = createRootMetadata();

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await waitForRuntimeData();

  let bodyClassName = "min-h-dvh bg-background antialiased overflow-x-hidden tabular-nums";
  let content: ReactNode;

  if (!isDatabaseAvailable()) {
    bodyClassName =
      "min-h-screen bg-background antialiased flex items-center justify-center tabular-nums";
    content = (
      <div className="max-w-md w-full mx-4 rounded-lg border bg-card p-8 text-center shadow-sm">
        <DatabaseZap className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">データベースが見つかりません</h1>
        <p className="text-muted-foreground mb-4">
          データベースファイルが存在しないため、ダッシュボードを表示できません。
        </p>
        <p className="text-sm text-muted-foreground">
          クローラーを実行してデータを取得してください。
        </p>
      </div>
    );
  } else {
    const groups = await getAllGroups();
    const currentGroup = await getCurrentGroup();
    const defaultGroupId = currentGroup?.id ?? groups[0]?.id ?? null;
    // ルートレイアウトは表示中のグループを知れないため、グループごとに通知を
    // 用意して Header に選ばせる。静的エクスポート中の重い計算はグループごとに
    // 1 回で済む（lib/static-cache.ts）。
    const notifications: Record<string, ReactNode> = {
      [DEFAULT_NOTIFICATIONS_KEY]: <AccountNotifications />,
    };
    for (const group of groups) {
      if (group.id === currentGroup?.id) continue;
      notifications[group.id] = <AccountNotifications groupId={group.id} />;
    }
    content = (
      <SidebarProvider>
        <Header
          groups={groups.map((group) => ({
            id: group.id,
            name: group.name,
            isCurrent: group.isCurrent ?? false,
            lastScrapedAt: group.lastScrapedAt,
          }))}
          defaultGroupId={defaultGroupId}
          notifications={notifications}
        />
        <div className="flex pt-14">
          <Sidebar />
          <main className="flex-1 lg:ml-60 overflow-x-hidden px-4 py-6 lg:px-8">
            <div className="max-w-7xl mx-auto w-full">{children}</div>
          </main>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <html lang="ja">
      <body className={bodyClassName}>{content}</body>
    </html>
  );
}
