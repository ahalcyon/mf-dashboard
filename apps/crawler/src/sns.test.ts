import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildErrorMessage, buildSuccessMessage, toSubject } from "./sns.js";
import type { NotificationPayload } from "./types.js";

function buildData(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    summary: {
      totalAssets: "5,259,382円",
      dailyChange: "",
      dailyChangePercent: "",
      monthlyChange: "+2,140,505円",
      monthlyChangePercent: "+2.2%",
    },
    items: [
      { name: "合計", balance: "5,259,382円", previousBalance: "5,258,000円", change: "+1,382円" },
      { name: "預金・現金", balance: "3,000,000円", previousBalance: "3,000,000円", change: "0円" },
      { name: "株式", balance: "2,259,382円", previousBalance: "2,258,000円", change: "+1,382円" },
    ],
    updatedAt: "2026年8月25日 6:45",
    groupName: "Group A",
    accountIssues: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("toSubject", () => {
  test("SNS が受け付けない非 ASCII を落とす", () => {
    expect(toSubject("Money Forward 更新 total 5,259,382円")).toBe("Money Forward total 5,259,382");
  });

  test("100 文字で切り詰める", () => {
    expect(toSubject("a".repeat(150))).toHaveLength(100);
  });

  test("改行を空白へ畳む", () => {
    expect(toSubject("first\nsecond")).toBe("first second");
  });

  test("ASCII が残らない場合でも空にしない", () => {
    expect(toSubject("更新完了")).toBe("Money Forward update");
  });
});

describe("buildSuccessMessage", () => {
  test("総資産・前日比・今月比を載せる", () => {
    const message = buildSuccessMessage(buildData());

    expect(message).toContain("総資産: 5,259,382円");
    // 前日比は資産内訳の「合計」行から取る
    expect(message).toContain("前日比: +1,382円");
    expect(message).toContain("今月比: +2,140,505円 (+2.2%)");
  });

  test("グループ名を見出しへ入れる", () => {
    expect(buildSuccessMessage(buildData())).toContain("Money Forward 更新レポート (Group A)");
  });

  test("グループ名が無ければ見出しに括弧を付けない", () => {
    const message = buildSuccessMessage(buildData({ groupName: undefined }));

    expect(message.split("\n")[0]).toBe("Money Forward 更新レポート");
  });

  test("資産内訳から合計行を除く", () => {
    const message = buildSuccessMessage(buildData());

    expect(message).toContain("預金・現金: 3,000,000円 (0円)");
    expect(message).toContain("株式: 2,259,382円 (+1,382円)");
    expect(message.match(/合計/g)).toBeNull();
  });

  test("合計行が無ければ前日比をハイフンにする", () => {
    const message = buildSuccessMessage(
      buildData({
        items: [{ name: "株式", balance: "1円", previousBalance: "1円", change: "0円" }],
      }),
    );

    expect(message).toContain("前日比: -");
  });

  test("内訳が空なら資産内訳の節を出さない", () => {
    expect(buildSuccessMessage(buildData({ items: [] }))).not.toContain("資産内訳");
  });

  test("今月比のパーセントが取れなければ括弧を付けない", () => {
    const data = buildData();
    data.summary.monthlyChangePercent = "";

    expect(buildSuccessMessage(data)).toContain("今月比: +2,140,505円\n");
  });

  test("更新中とエラーの口座を状態付きで並べる", () => {
    const message = buildSuccessMessage(
      buildData({
        accountIssues: [
          { name: "Bank A", status: "updating" },
          { name: "Bank B", status: "error", errorMessage: "認証に失敗しました" },
          { name: "Bank C", status: "error" },
        ],
      }),
    );

    expect(message).toContain("Bank A (更新中)");
    expect(message).toContain("Bank B (エラー: 認証に失敗しました)");
    expect(message).toContain("Bank C (エラー)");
  });

  test("問題のある口座が無ければアカウント状態の節を出さない", () => {
    expect(buildSuccessMessage(buildData())).not.toContain("アカウント状態");
  });

  test("DASHBOARD_URL があれば末尾へリンクを置く", () => {
    vi.stubEnv("DASHBOARD_URL", "https://dashboard.example.com");

    expect(buildSuccessMessage(buildData()).trimEnd()).toMatch(
      /https:\/\/dashboard\.example\.com$/,
    );
  });

  test("DASHBOARD_URL が無ければ更新日時で終わる", () => {
    vi.stubEnv("DASHBOARD_URL", "");

    expect(buildSuccessMessage(buildData()).trimEnd()).toMatch(/更新日時: 2026年8月25日 6:45$/);
  });
});

describe("buildErrorMessage", () => {
  test("原因と発生日時を載せる", () => {
    const message = buildErrorMessage("Timeout 30000ms exceeded", "2026年8月25日 6:45");

    expect(message).toContain("Money Forward の更新に失敗しました");
    expect(message).toContain("Timeout 30000ms exceeded");
    expect(message).toContain("発生日時: 2026年8月25日 6:45");
  });
});
