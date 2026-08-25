"use client";

import { mfUrls } from "@mf-dashboard/meta/urls";
import { Home, HelpCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { withBasePath } from "../../lib/base-path";
import { formatDateTime } from "../../lib/format";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { IconButton } from "../ui/icon-button";

interface ActionIconsProps {
  variant: "header" | "sidebar";
  notifications?: ReactNode;
  lastScrapedAt?: string | null;
}

interface LastUpdatedAtProps {
  lastScrapedAt: string | null;
}

export function ActionIcons({ variant, notifications, lastScrapedAt }: ActionIconsProps) {
  const iconSize = variant === "header" ? "h-4.5 w-4.5" : "h-5 w-5";

  if (variant === "sidebar") {
    return (
      <div className="border-t p-4 flex items-center gap-1 lg:hidden">
        <HelpButton iconSize={iconSize} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <LastUpdatedAt lastScrapedAt={lastScrapedAt ?? null} />
      <RefreshControl iconSize={iconSize} />
      {notifications}
      <HomeButton iconSize={iconSize} />
      <HelpButton iconSize={iconSize} className="hidden lg:block" />
    </div>
  );
}

function RefreshControl({ iconSize }: { iconSize: string }) {
  const router = useRouter();
  const [state, setState] = useState<RefreshState>({ kind: "idle" });

  async function startRefresh() {
    if (state.kind === "starting") return;

    setState({ kind: "starting" });
    try {
      const response = await fetch(withBasePath("/api/refresh/"), { method: "POST" });

      if (response.status === 409) {
        setState({ kind: "already-running" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "failed" });
        return;
      }

      setState({ kind: "started" });
      // クロールが終わるとサイトが焼き直されるので、最終更新の表示を取り直す
      router.refresh();
    } catch {
      setState({ kind: "failed" });
    }
  }

  const presentation = refreshPresentation[state.kind];

  return (
    <>
      <IconButton
        icon={
          <RefreshCw
            className={`${iconSize} ${state.kind === "starting" ? "animate-spin text-primary/90" : ""}`}
          />
        }
        ariaLabel={presentation.label}
        disabled={state.kind === "starting"}
        title={presentation.label}
        onClick={() => void startRefresh()}
      />
      <output aria-live="polite" className="sr-only">
        {presentation.status}
      </output>
    </>
  );
}

type RefreshState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "started" }
  | { kind: "already-running" }
  | { kind: "failed" };

/**
 * 起動までしか分からない。クロールの完了はサイトが焼き直されて
 * 最終更新の表示が進むことで分かる。
 */
const refreshPresentation: Record<RefreshState["kind"], { label: string; status: string }> = {
  idle: { label: "金融機関データを更新", status: "" },
  starting: { label: "更新を開始しています", status: "更新を開始しています" },
  started: {
    label: "更新を開始しました",
    status: "更新を開始しました。完了までしばらくかかります",
  },
  "already-running": { label: "すでに更新中です", status: "すでに更新中です" },
  failed: { label: "更新を開始できませんでした", status: "更新を開始できませんでした" },
};

function LastUpdatedAt({ lastScrapedAt }: LastUpdatedAtProps) {
  const formattedLastScrapedAt = lastScrapedAt ? formatDateTime(lastScrapedAt) : null;

  if (!formattedLastScrapedAt) {
    return null;
  }

  return (
    <time
      className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
      dateTime={lastScrapedAt ?? undefined}
      aria-label={`最終更新 ${formattedLastScrapedAt}`}
    >
      {formattedLastScrapedAt}
    </time>
  );
}

function HelpButton({ iconSize, className }: { iconSize: string; className?: string }) {
  return (
    <Dialog>
      <DialogTrigger className={className}>
        <IconButton icon={<HelpCircle className={iconSize} />} ariaLabel="ヘルプ" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>MoneyForward Me Dashboard について</DialogTitle>
          <IconButton
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.3c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
              </svg>
            }
            href="https://github.com/hiroppy/mf-dashboard"
            ariaLabel="GitHub リポジトリ"
            isExternal
          />
        </div>
        <DialogDescription asChild>
          <div className="mt-2 text-sm text-muted-foreground space-y-4">
            <p>MoneyForward Me を自動化・可視化するダッシュボードです。</p>
            <div>
              <h3 className="font-semibold mb-2 text-foreground">機能</h3>
              <ul className="list-disc list-inside space-y-2 text-sm">
                <li>
                  <span className="font-medium text-foreground">金融機関の一括更新</span>
                  <span className="block ml-5 mt-1">
                    定期的に登録金融機関の「一括更新」を自動実行します。
                  </span>
                </li>
                <li>
                  <span className="font-medium text-foreground">すべての情報を可視化</span>
                  <span className="block ml-5 mt-1">
                    資産状況、収支、ポートフォリオなど MoneyForward Me
                    のデータをダッシュボードで確認できます。
                  </span>
                </li>
                <li>
                  <span className="font-medium text-foreground">Slack 通知</span>
                  <span className="block ml-5 mt-1">前日との差分を Slack へ自動投稿できます。</span>
                </li>
                <li>
                  <span className="font-medium text-foreground">カスタム処理（Hooks）</span>
                  <span className="block ml-5 mt-1">
                    スクレイピング時に独自のスクリプトを実行できます。
                  </span>
                </li>
                <li>
                  <span className="font-medium text-foreground">資産データのエクスポート</span>
                  <span className="block ml-5 mt-1">
                    日次の資産推移や保有銘柄を JSON と Markdown で書き出せます。
                  </span>
                </li>
              </ul>
            </div>
            <div className="pt-2 border-t">
              <a
                href="https://github.com/hiroppy/mf-dashboard/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                バグ報告・機能要望
              </a>
            </div>
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function HomeButton({ iconSize }: { iconSize: string }) {
  return (
    <IconButton
      icon={<Home className={iconSize} />}
      href={mfUrls.home}
      ariaLabel="Money Forward"
      isExternal
    />
  );
}
