"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { withBasePath } from "../../lib/base-path";
import { extractGroupIdFromPath } from "../../lib/url";
import { IconButton } from "../ui/icon-button";
import { ActionIcons } from "./action-icons";
import { GroupSelectorDisplay, groupSelectorContainerClassName } from "./group-selector-display";
import { GroupSelectorClient, type Group } from "./group-selector.client";
import { useSidebar } from "./sidebar-context";

/** 既定グループ（グループ id を含まない URL）の通知に使うキー。 */
export const DEFAULT_NOTIFICATIONS_KEY = "__default__";

interface HeaderProps {
  groups: Group[];
  defaultGroupId: string | null;
  /**
   * グループ id をキーにした通知ノード。表示中のグループのものを選ぶ。
   * ルートレイアウトは URL を知らないため、選択はここで行う。
   */
  notifications?: Record<string, ReactNode>;
}

export function Header({ groups, defaultGroupId, notifications }: HeaderProps) {
  const { toggle } = useSidebar();
  const pathname = usePathname();
  const urlGroupId = extractGroupIdFromPath(pathname);
  const selectedGroup =
    groups.find((group) => group.id === urlGroupId) ??
    groups.find((group) => group.id === defaultGroupId) ??
    null;

  const groupNotifications =
    (urlGroupId ? notifications?.[urlGroupId] : undefined) ??
    notifications?.[DEFAULT_NOTIFICATIONS_KEY];

  let groupSelector: ReactNode = null;
  if (groups.length > 1 && defaultGroupId) {
    groupSelector = <GroupSelectorClient groups={groups} defaultGroupId={defaultGroupId} />;
  } else if (selectedGroup) {
    groupSelector = (
      <div className={groupSelectorContainerClassName}>
        <GroupSelectorDisplay name={selectedGroup.name} />
      </div>
    );
  }

  return (
    <header className="fixed top-0 z-50 w-full border-b bg-card text-foreground shadow-sm">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center min-w-0 gap-2">
          <IconButton
            icon={<Menu className="h-5 w-5" />}
            onClick={toggle}
            ariaLabel="メニューを開く"
            className="lg:hidden shrink-0"
          />
          <Image
            src={withBasePath("/logo.png")}
            alt="Logo"
            width={758}
            height={708}
            className="hidden h-auto w-8 shrink-0 lg:block"
          />
          <div className="flex flex-col gap-0.5">{groupSelector}</div>
        </div>
        <ActionIcons
          variant="header"
          notifications={groupNotifications}
          lastScrapedAt={selectedGroup?.lastScrapedAt ?? null}
        />
      </div>
    </header>
  );
}
