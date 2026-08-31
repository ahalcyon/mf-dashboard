"use client";

import { mfUrls } from "@mf-dashboard/meta/urls";
import { Home, HelpCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { withBasePath } from "../../lib/base-path";
import { formatDateTime } from "../../lib/format";
import { Button } from "../ui/button";
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
  const [isConfirming, setIsConfirming] = useState(false);

  async function startRefresh() {
    if (state.kind === "starting") return;

    setIsConfirming(false);
    setState({ kind: "starting" });
    try {
      const response = await fetch(refreshEndpoint(), {
        method: "POST",
        headers: { "x-amz-content-sha256": EMPTY_BODY_SHA256 },
      });

      if (response.status === 409) {
        setState({ kind: "already-running" });
        return;
      }
      // エッジの認証で弾かれた場合。fetch は Basic 認証の資格情報を送らないので、
      // セッションクッキーが無くなると何度押しても復帰しない。待っても直らない
      // 相手に「しばらく待って」と言わないよう、再読み込みへ誘導する。
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "session-expired" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "failed", status: response.status });
        return;
      }

      setState({ kind: "started" });
      // クロールが終わるとサイトが焼き直されるので、最終更新の表示を取り直す
      router.refresh();
    } catch {
      // ここに来るのは要求そのものが出せなかったとき。サーバーには痕跡が残らない
      // ので、応答が返った上での失敗と混ぜると原因を切り分けられなくなる。
      setState({ kind: "unreachable" });
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
        onClick={() => setIsConfirming(true)}
      />
      <output aria-live="polite" className="sr-only">
        {presentation.status}
      </output>

      {/* 押しても画面が変わらないと、走ったかどうか分からず何度も押すことになる。
          クロールは Money Forward へログインして一括更新を回す重い処理なので、
          先に確認を挟む。 */}
      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent className="max-w-md">
          <DialogTitle>金融機関データを更新しますか</DialogTitle>
          <DialogDescription asChild>
            <div className="mt-2 space-y-3 text-sm text-muted-foreground">
              <p>Money Forward にログインして、登録金融機関の一括更新を実行します。</p>
              <p>
                完了まで数分から 20 分ほどかかります。
                <span className="block">
                  この画面に結果が出るのは、取得したデータでサイトが作り直されたあとです。
                </span>
              </p>
            </div>
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsConfirming(false)}>
              キャンセル
            </Button>
            <Button type="button" onClick={() => void startRefresh()}>
              更新を開始
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 結果は読み上げだけでなく目にも見える形で残す */}
      <Dialog
        open={state.kind !== "idle" && state.kind !== "starting"}
        onOpenChange={(open) => {
          if (!open) setState({ kind: "idle" });
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>{presentation.label}</DialogTitle>
          <DialogDescription asChild>
            <p className="mt-2 text-sm text-muted-foreground">{detailFor(state)}</p>
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant={state.kind === "session-expired" ? "outline" : "default"}
              onClick={() => setState({ kind: "idle" })}
            >
              閉じる
            </Button>
            {state.kind === "session-expired" && (
              <Button type="button" onClick={() => window.location.reload()}>
                再読み込み
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 資格情報を含まない絶対 URL を組み立てる。
 *
 * このダッシュボードは https://user:pass@host/ をブックマークして踏む運用を
 * 想定している（terraform/aws/site.tf を参照）。その場合ドキュメントの URL に
 * 資格情報が残り、相対パスを解決した結果も資格情報付きになる。fetch は
 * そのような URL から Request を作れず、同期的に投げる。
 *
 *   TypeError: Failed to execute 'fetch' on 'Window':
 *   Request cannot be constructed from a URL that includes credentials
 *
 * location.origin は scheme + host + port だけで、資格情報を持たない。
 */
function refreshEndpoint(): string {
  const path = withBasePath("/api/refresh/");
  // SSR とテスト環境では location を当てにしない
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

/**
 * CloudFront が OAC で Lambda を呼ぶとき、Lambda は署名されていない本文を
 * 受け付けない。本文が空でもそのハッシュを送る必要がある。
 */
const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

type RefreshState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "started" }
  | { kind: "already-running" }
  | { kind: "session-expired" }
  | { kind: "unreachable" }
  | { kind: "failed"; status: number };

/**
 * 起動までしか分からない。クロールの完了はサイトが焼き直されて
 * 最終更新の表示が進むことで分かる。
 */
const refreshPresentation: Record<
  RefreshState["kind"],
  { label: string; status: string; detail: string }
> = {
  idle: { label: "金融機関データを更新", status: "", detail: "" },
  starting: {
    label: "更新を開始しています",
    status: "更新を開始しています",
    detail: "更新の開始を要求しています。",
  },
  started: {
    label: "更新を開始しました",
    status: "更新を開始しました。完了までしばらくかかります",
    detail:
      "完了まで数分から 20 分ほどかかります。取得したデータでサイトが作り直されると、この画面の最終更新が進みます。結果はメールでも届きます。",
  },
  "already-running": {
    label: "すでに更新中です",
    status: "すでに更新中です",
    detail: "前回の更新がまだ実行中です。二重に起動しないよう、今回の要求は見送りました。",
  },
  "session-expired": {
    label: "認証の期限が切れました",
    status: "認証の期限が切れました。ページを再読み込みしてください",
    detail:
      "ページを開いたままにしている間に認証が切れました。このまま押し直しても開始できません。再読み込みすると復帰します。",
  },
  unreachable: {
    label: "サーバーに接続できませんでした",
    status: "サーバーに接続できませんでした",
    detail:
      "要求を送れませんでした。サーバーには届いていません。通信状況を確かめて、もう一度試してください。",
  },
  failed: {
    label: "更新を開始できませんでした",
    status: "更新を開始できませんでした",
    detail: "更新を開始できませんでした。しばらく待ってからもう一度試してください。",
  },
};

/** 失敗時は応答コードを添える。次に同じ報告を受けたとき原因を絞れるようにする。 */
function detailFor(state: RefreshState): string {
  const base = refreshPresentation[state.kind].detail;
  return state.kind === "failed" ? `${base}（応答コード ${state.status}）` : base;
}

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
                  <span className="font-medium text-foreground">メール通知</span>
                  <span className="block ml-5 mt-1">前日との差分をメールで受け取れます。</span>
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
