import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionIcons } from "./action-icons";

const originalFetch = global.fetch;
const { refreshMock, routerMock } = vi.hoisted(() => {
  const refreshMock = vi.fn<() => void>();
  return { refreshMock, routerMock: { refresh: refreshMock } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

function respondWith(status: number): void {
  global.fetch = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify({ status }), { status })),
  );
}

function refreshButton(name = "金融機関データを更新"): HTMLElement {
  return screen.getByRole("button", { name });
}

/** 確認ダイアログを開き、「更新を開始」を押すところまで進める。 */
async function confirmRefresh(): Promise<void> {
  fireEvent.click(refreshButton());
  fireEvent.click(await screen.findByRole("button", { name: "更新を開始" }));
}

beforeEach(() => {
  refreshMock.mockClear();
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ActionIcons の更新ボタン", () => {
  it("クロールの起動を要求する", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`${window.location.origin}/api/refresh/`, {
        method: "POST",
        headers: {
          "x-amz-content-sha256":
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });
    });
  });

  it("起動できたら開始したことを伝える", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(await screen.findByRole("heading", { name: "更新を開始しました" })).not.toBeNull();
  });

  it("起動できたら最終更新の表示を取り直す", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledOnce();
    });
  });

  // #80 の中身。ブックマークが https://user:pass@host/ 形式だとドキュメントの
  // URL に資格情報が残り、相対パスを解決した結果も資格情報付きになる。fetch は
  // 出ないまま失敗する。資格情報を持たない location.origin から組み立てる。
  it("資格情報を含まない絶対 URL へ要求する", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const [url] = vi.mocked(global.fetch).mock.calls[0] as [string];
    expect(url).toBe(`${window.location.origin}/api/refresh/`);
    expect(url).not.toContain("@");
  });

  it("すでに実行中なら二重に起動したと誤解させない", async () => {
    respondWith(409);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(await screen.findByRole("heading", { name: "すでに更新中です" })).not.toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("起動に失敗したことを伝える", async () => {
    respondWith(502);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(
      await screen.findByRole("heading", { name: "更新を開始できませんでした" }),
    ).not.toBeNull();
  });

  // #80。エッジの認証で弾かれると 401 が返る。fetch は Basic 認証の資格情報を
  it.for([401, 403])("%d なら認証切れとして扱い、待つよう案内しない", async (status) => {
    respondWith(status);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(await screen.findByRole("heading", { name: "認証の期限が切れました" })).not.toBeNull();
    expect(screen.queryByText(/しばらく待って/)).toBeNull();
  });

  it("認証切れのときは再読み込みの手段を出す", async () => {
    respondWith(401);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(await screen.findByRole("button", { name: "再読み込み" })).not.toBeNull();
  });

  it("認証切れ以外では再読み込みを出さない", async () => {
    respondWith(502);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    await screen.findByRole("heading", { name: "更新を開始できませんでした" });
    expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
  });

  // 要求が出せなかった場合はサーバーに痕跡が残らない。応答が返った上での
  // 失敗と同じ文言にすると、報告を受けても切り分けられない（#80）。
  it("要求を送れなかった場合は応答を得た失敗と区別する", async () => {
    global.fetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(
      await screen.findByRole("heading", { name: "サーバーに接続できませんでした" }),
    ).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "更新を開始できませんでした" })).toBeNull();
  });

  // 次に同じ報告を受けたとき、どこで落ちたかを問い合わせずに済むようにする。
  it("応答を得た失敗では応答コードを添える", async () => {
    respondWith(502);
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    await screen.findByRole("heading", { name: "更新を開始できませんでした" });
    expect(screen.getByText(/応答コード 502/)).not.toBeNull();
  });

  // 押しても画面が変わらないと、走ったかどうか分からず何度も押すことになる
  it("押しただけではクロールを起動しない", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    fireEvent.click(refreshButton());

    expect(
      await screen.findByRole("heading", { name: "金融機関データを更新しますか" }),
    ).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("キャンセルすれば起動しない", async () => {
    respondWith(202);
    render(<ActionIcons variant="header" />);

    fireEvent.click(refreshButton());
    fireEvent.click(await screen.findByRole("button", { name: "キャンセル" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("サイドバーでは更新ボタンを出さない", () => {
    render(<ActionIcons variant="sidebar" />);

    expect(screen.queryByRole("button", { name: /更新/ })).toBeNull();
  });
});
