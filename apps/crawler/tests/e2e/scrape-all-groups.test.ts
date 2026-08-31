import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext } from "playwright";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createCrawlerProgressReporter } from "../../src/crawler-progress.js";
import type { ScrapeResult } from "../../src/scraper.js";
import { scrapeAllGroups } from "../../src/scraper.js";
import { isNoGroup } from "../../src/scrapers/group.js";
import { createAnonymousGroupScope } from "./group-state.js";
import {
  gotoHome,
  launchLoggedInContext,
  saveScreenshot,
  withErrorScreenshot,
  withNewPage,
} from "./helpers.js";

let browser: Browser;
let context: BrowserContext;
let result: ScrapeResult;
const progressStatePath = path.join(os.tmpdir(), `scrape-all-groups-${randomUUID()}.json`);

beforeAll(async () => {
  ({ browser, context } = await launchLoggedInContext());
  result = await withNewPage(context, async (page) => {
    await gotoHome(page);
    await saveScreenshot(page, "scrape-all-groups-test-before-scrape.png");

    return withErrorScreenshot(page, "scrape-all-groups-test-error.png", async () => {
      await using _scope = await createAnonymousGroupScope(page);
      const progress = await createCrawlerProgressReporter(progressStatePath, {
        id: randomUUID(),
        source: "e2e",
        startedAt: new Date().toISOString(),
      });
      return scrapeAllGroups(page, progress, { skipRefresh: true });
    });
  });
}, 300000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await rm(progressStatePath, { force: true });
});

describe("scrapeAllGroups", () => {
  describe("ScrapeResult構造", () => {
    test("globalData, groupDataList, defaultGroupを返す", () => {
      expect(result.globalData).toBeDefined();
      // Array.isArray は空配列でも真になる。セレクタが外れて 0 件になる
      expect(result.groupDataList.length).toBeGreaterThan(0);
    });

    // 「null または有効」を 1 つの表明にまとめると、既定グループの検出が
    // 完全に壊れて常に null になったときに無条件で通る。検出できていること
    // 自体を分けて見る。
    test("defaultGroupを検出できる", () => {
      expect(result.defaultGroup).not.toBeNull();
    });

    test("defaultGroupが有効なGroupオブジェクトである", () => {
      const defaultGroup = result.defaultGroup;
      if (defaultGroup === null) throw new Error("defaultGroup was not detected");

      expect(typeof defaultGroup.id).toBe("string");
      expect(defaultGroup.id.length).toBeGreaterThan(0);
      expect(typeof defaultGroup.name).toBe("string");
      expect(defaultGroup.name.length).toBeGreaterThan(0);
      expect(typeof defaultGroup.isCurrent).toBe("boolean");
    });
  });

  describe("GlobalData (Phase 1)", () => {
    test("registeredAccountsが取得できる", () => {
      expect(result.globalData.registeredAccounts).toBeDefined();
      expect(result.globalData.registeredAccounts.accounts.length).toBeGreaterThan(0);
    });

    test("portfolioが取得できる", () => {
      expect(result.globalData.portfolio).toBeDefined();
      expect(result.globalData.portfolio.items.length).toBeGreaterThan(0);
    });

    test("liabilitiesが取得できる", () => {
      expect(result.globalData.liabilities).toBeDefined();
      expect(Array.isArray(result.globalData.liabilities.items)).toBe(true);
    });

    test("cashFlowが取得できる", () => {
      expect(result.globalData.cashFlow).toBeDefined();
      expect(result.globalData.cashFlow.month).toBeTruthy();
      expect(Array.isArray(result.globalData.cashFlow.items)).toBe(true);
    });

    test("refreshResultがnullまたは有効なオブジェクト", () => {
      expect(result.globalData.refreshResult).toBeNull();
    });
  });

  describe("GroupDataList (Phase 2)", () => {
    test("少なくとも1つのグループがある", () => {
      expect(result.groupDataList.length).toBeGreaterThan(0);
    });

    test("「グループ選択なし」が含まれる", () => {
      const noGroupData = result.groupDataList.find((gd) => isNoGroup(gd.group.id));
      expect(noGroupData).toBeDefined();
    });

    test("各グループにgroup情報がある", () => {
      for (const groupData of result.groupDataList) {
        expect(Boolean(groupData.group.id) && Boolean(groupData.group.name)).toBe(true);
        expect(typeof groupData.group.isCurrent).toBe("boolean");
      }
    });

    test("各グループにregisteredAccountsがある", () => {
      for (const groupData of result.groupDataList) {
        expect(groupData.registeredAccounts).toBeDefined();
        expect(Array.isArray(groupData.registeredAccounts.accounts)).toBe(true);
      }
    });

    test("各グループにassetHistoryがある", () => {
      for (const groupData of result.groupDataList) {
        expect(groupData.assetHistory).toBeDefined();
        expect(Array.isArray(groupData.assetHistory.points)).toBe(true);
      }
    });

    test("各グループにsummaryがある", () => {
      for (const groupData of result.groupDataList) {
        expect(groupData.summary).toBeDefined();
        // !== undefined は null でも真になる。取得できなかった状態を通す。
        expect(typeof groupData.summary.totalAssets).toBe("number");
      }
    });

    // 個々のカスタムグループは空でも不思議はないが、「グループ選択なし」は
    test("「グループ選択なし」の各構造が空でない", () => {
      const noGroupData = result.groupDataList.find((gd) => isNoGroup(gd.group.id));
      expect(noGroupData).toBeDefined();
      if (!noGroupData) return;

      expect(noGroupData.registeredAccounts.accounts.length).toBeGreaterThan(0);
      expect(noGroupData.assetHistory.points.length).toBeGreaterThan(0);
      expect(noGroupData.items.length).toBeGreaterThan(0);
    });

    test("各グループにitemsがある", () => {
      for (const groupData of result.groupDataList) {
        expect(groupData.items).toBeDefined();
        expect(Array.isArray(groupData.items)).toBe(true);
      }
    });
  });

  describe("isCurrentフラグ", () => {
    test("正確に1つのグループがisCurrent=trueである", () => {
      const currentGroups = result.groupDataList.filter((gd) => gd.group.isCurrent);
      expect(currentGroups.length).toBe(1);
    });

    // defaultGroup === null を許すと、既定グループの検出が壊れたときに
    test("isCurrent=trueのグループはdefaultGroupと一致する", () => {
      const currentGroup = result.groupDataList.find((gd) => gd.group.isCurrent);

      // 両方 undefined でも通る比較にならないよう、先に存在を確かめる。
      expect(currentGroup).toBeDefined();
      expect(result.defaultGroup).not.toBeNull();
      expect(currentGroup?.group.id).toBe(result.defaultGroup?.id);
    });
  });

  describe("グループごとのアカウント数", () => {
    test("「グループ選択なし」は全アカウントを含む", () => {
      const noGroupData = result.groupDataList.find((gd) => isNoGroup(gd.group.id));
      const globalAccountCount = result.globalData.registeredAccounts.accounts.length;

      expect(noGroupData?.registeredAccounts.accounts.length).toBe(globalAccountCount);
    });

    test("各グループのアカウント数は「グループ選択なし」以下である", () => {
      const noGroupData = result.groupDataList.find((gd) => isNoGroup(gd.group.id));

      // ?? 0 で既定値を置くと、擬似グループを取りこぼしたときに
      // 「全グループが 0 件以下」という別の意味の表明にすり替わる。
      expect(noGroupData).toBeDefined();
      if (!noGroupData) return;
      const maxAccounts = noGroupData.registeredAccounts.accounts.length;

      for (const groupData of result.groupDataList) {
        expect(groupData.registeredAccounts.accounts.length).toBeLessThanOrEqual(maxAccounts);
      }
    });
  });
});
