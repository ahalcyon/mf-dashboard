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
      expect(global.fetch).toHaveBeenCalledWith("/api/refresh/", {
        method: "POST",
        // Lambda は署名されていない本文を受け付けないため、空でもハッシュを送る
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

  it("通信そのものが失敗しても状態を残さない", async () => {
    global.fetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    render(<ActionIcons variant="header" />);

    await confirmRefresh();

    expect(
      await screen.findByRole("heading", { name: "更新を開始できませんでした" }),
    ).not.toBeNull();
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
