import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildNotificationPayload,
  selectNotificationGroup,
  sendSuccessNotifications,
} from "./notification.js";
import type { GroupData } from "./scraper.js";
import { NO_GROUP_ID } from "./scrapers/group.js";
import { sendSnsNotification } from "./sns.js";

vi.mock("./sns.js", () => ({
  sendSnsNotification: vi.fn<() => Promise<void>>(),
  sendSnsErrorNotification: vi.fn<() => Promise<void>>(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendSnsNotification).mockResolvedValue(undefined);
});

function makeGroupData(id: string, name: string): GroupData {
  return {
    group: { id, name, isCurrent: false },
    registeredAccounts: {
      accounts: [
        {
          mfId: `${id}-account-a`,
          name: "Account A",
          type: "自動連携",
          status: "ok",
          lastUpdated: "2026-07-15",
          url: "/accounts/show/account-a",
          totalAssets: 1000,
        },
        {
          mfId: `${id}-account-b`,
          name: "Account B",
          type: "自動連携",
          status: "updating",
          lastUpdated: "2026-07-15",
          url: "/accounts/show/account-b",
          totalAssets: 2000,
        },
        {
          mfId: `${id}-account-c`,
          name: "Account C",
          type: "自動連携",
          status: "error",
          lastUpdated: "2026-07-15",
          url: "/accounts/show/account-c",
          totalAssets: 3000,
          errorMessage: "Connection failed",
        },
      ],
    },
    assetHistory: { points: [] },
    spendingTargets: { categories: [] },
    summary: {
      totalAssets: "6,000",
      dailyChange: "+100",
      dailyChangePercent: "+1.7%",
      monthlyChange: "+500",
      monthlyChangePercent: "+8.3%",
    },
    items: [
      {
        name: "合計",
        balance: "6,000",
        previousBalance: "5,900",
        change: "+100",
      },
    ],
  };
}

describe("selectNotificationGroup", () => {
  test("default groupに一致するデータを選ぶ", () => {
    const groupA = makeGroupData("group-a", "Group A");
    const groupB = makeGroupData("group-b", "Group B");

    expect(selectNotificationGroup([groupA, groupB], groupB.group)).toBe(groupB);
  });

  test("default groupがない場合は先頭データを選ぶ", () => {
    const groupA = makeGroupData("group-a", "Group A");
    const groupB = makeGroupData("group-b", "Group B");

    expect(selectNotificationGroup([groupA, groupB], null)).toBe(groupA);
  });
});

describe("buildNotificationPayload", () => {
  test("通知用payloadにgroup dataとaccount issueを反映する", () => {
    const groupData = makeGroupData("group-a", "Group A");
    const payload = buildNotificationPayload(groupData, new Date("2026-07-15T09:00:00.000Z"));

    expect(payload.summary).toBe(groupData.summary);
    expect(payload.items).toBe(groupData.items);
    expect(payload.groupName).toBe("Group A");
    expect(payload.updatedAt).toContain("2026");
    expect(payload.accountIssues).toEqual([
      {
        name: "Account B",
        status: "updating",
        errorMessage: undefined,
      },
      {
        name: "Account C",
        status: "error",
        errorMessage: "Connection failed",
      },
    ]);
  });

  test("「グループ選択なし」は擬似グループなので groupName を載せない", () => {
    const groupData = makeGroupData(NO_GROUP_ID, "グループ選択なし");

    expect(buildNotificationPayload(groupData).groupName).toBeUndefined();
  });

  test("名前ではなく ID で判定する", () => {
    // 実グループに「グループ選択なし」と付けることもできる。名前で弾くと消えてしまう。
    const groupData = makeGroupData("group-a", "グループ選択なし");

    expect(buildNotificationPayload(groupData).groupName).toBe("グループ選択なし");
  });
});

describe("sendSuccessNotifications", () => {
  test("通知 channel の失敗を caller に返す", async () => {
    const failure = new Error("notification unavailable");
    vi.mocked(sendSnsNotification).mockRejectedValue(failure);

    await expect(
      sendSuccessNotifications([makeGroupData("group-a", "Group A")], null),
    ).rejects.toBe(failure);
  });
});
