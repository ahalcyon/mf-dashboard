import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
/**
 * デモデータ整合性テスト
 *
 * demo-db生成後に実行し、データの整合性を確認する。
 * - グループとアカウントの紐付け
 * - 振替トランザクションのtransferTargetAccountId
 * - 資産合計の整合性
 * - グループ外振替の検出
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import * as schema from "./schema/schema";

const dbPath = join(import.meta.dirname, "..", "..", "..", "data", "demo-db");

// demo-dbが存在しない場合はスキップ
const demoDbExists = existsSync(dbPath);
if (!demoDbExists && process.env.REQUIRE_DEMO_DB === "true") {
  throw new Error(`demo-dbが存在しません。先にbuild:demoを実行してください: ${dbPath}`);
}

describe.skipIf(!demoDbExists)("demo-db 整合性テスト", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle>;

  const findRows = async (query: string) => {
    const result = await client.query(query);
    return result.rows;
  };

  beforeAll(() => {
    client = new PGlite(dbPath);
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client?.close();
  });

  describe("グループ構成", () => {
    test("3つのグループが存在する", async () => {
      const groups = await db.select().from(schema.groups);
      expect(groups).toHaveLength(3);

      const names = groups.map((g) => g.name);
      expect(names).toContain("グループ選択なし");
      expect(names).toContain("投資");
      expect(names).toContain("生活");
    });

    test("グループ選択なしがisCurrent=trueである", async () => {
      const currentGroup = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.isCurrent, true))
        .then((rows) => rows.at(0)!);
      expect(currentGroup).toBeDefined();
      expect(currentGroup?.name).toBe("グループ選択なし");
    });

    test("isCurrent=trueのグループは1つだけである", async () => {
      const currentGroups = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(eq(schema.groups.isCurrent, true));

      expect(currentGroups).toHaveLength(1);
    });

    test("全アカウントがグループ選択なしに所属している", async () => {
      const allAccounts = await db.select().from(schema.accounts);
      const noGroup = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.name, "グループ選択なし"))
        .then((rows) => rows.at(0)!);

      const groupAccountIds = (
        await db
          .select({ accountId: schema.groupAccounts.accountId })
          .from(schema.groupAccounts)
          .where(eq(schema.groupAccounts.groupId, noGroup!.id))
      ).map((ga) => ga.accountId);

      for (const acc of allAccounts) {
        expect(groupAccountIds).toContain(acc.id);
      }
    });
  });

  describe("振替トランザクション", () => {
    test("振替トランザクションにtransferTargetAccountIdが設定されている", async () => {
      const transfers = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.isTransfer, true));

      expect(transfers.length).toBeGreaterThan(0);

      // transferTargetがあるものはtransferTargetAccountIdも設定されているべき
      const withTarget = transfers.filter((t) => t.transferTarget !== null);
      for (const t of withTarget) {
        expect(t.transferTargetAccountId).not.toBeNull();
      }
    });

    test("transferTargetAccountIdは有効なアカウントIDである", async () => {
      const transfers = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.isTransfer, true),
            isNotNull(schema.transactions.transferTargetAccountId),
          ),
        );

      const accountIds = (await db.select({ id: schema.accounts.id }).from(schema.accounts)).map(
        (a) => a.id,
      );

      for (const t of transfers) {
        expect(accountIds).toContain(t.transferTargetAccountId);
      }
    });

    test("ゆうちょ銀行からの振替が存在する", async () => {
      // ゆうちょ銀行（貯蓄用）のIDを取得
      const yuchoAccount = await db
        .select()
        .from(schema.accounts)
        .where(sql`${schema.accounts.name} LIKE '%ゆうちょ銀行%'`)
        .then((rows) => rows.at(0)!);

      expect(yuchoAccount).toBeDefined();

      // ゆうちょ銀行（account_id）からの振替を検索
      const transfersFromYucho = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.isTransfer, true),
            eq(schema.transactions.accountId, yuchoAccount!.id),
          ),
        );

      expect(transfersFromYucho.length).toBeGreaterThan(0);
    });
  });

  describe("グループ外振替（収入変換対象）", () => {
    test("生活グループにはゆうちょ銀行が含まれない", async () => {
      const livingGroup = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.name, "生活"))
        .then((rows) => rows.at(0)!);

      expect(livingGroup).toBeDefined();

      const livingAccountIds = (
        await db
          .select({ accountId: schema.groupAccounts.accountId })
          .from(schema.groupAccounts)
          .where(eq(schema.groupAccounts.groupId, livingGroup!.id))
      ).map((ga) => ga.accountId);

      const yuchoAccount = await db
        .select()
        .from(schema.accounts)
        .where(sql`${schema.accounts.name} LIKE '%ゆうちょ銀行%'`)
        .then((rows) => rows.at(0)!);

      expect(yuchoAccount).toBeDefined();
      expect(livingAccountIds).not.toContain(yuchoAccount!.id);
    });

    test("生活グループ視点でグループ外振替が存在する", async () => {
      const livingGroup = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.name, "生活"))
        .then((rows) => rows.at(0)!);
      expect(livingGroup).toBeDefined();

      const livingAccountIds = new Set(
        (
          await db
            .select({ accountId: schema.groupAccounts.accountId })
            .from(schema.groupAccounts)
            .where(eq(schema.groupAccounts.groupId, livingGroup!.id))
        ).map((ga) => ga.accountId),
      );

      // 生活グループ内のアカウントに紐づく振替で、transferTargetがグループ外のもの
      const transfers = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.isTransfer, true),
            isNotNull(schema.transactions.transferTargetAccountId),
          ),
        );

      const outsideGroupTransfers = transfers.filter((t) => {
        const isAccountInGroup = livingAccountIds.has(t.accountId!);
        const isTargetOutsideGroup = !livingAccountIds.has(t.transferTargetAccountId!);
        return isAccountInGroup && isTargetOutsideGroup;
      });

      expect(outsideGroupTransfers.length).toBeGreaterThan(0);
    });
  });

  describe("資産整合性", () => {
    test("全体グループに基準日3日のスナップショットが1件存在する", async () => {
      const snapshots = await db.select().from(schema.dailySnapshots);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.groupId).toBe("0");
      expect(snapshots[0]?.date).toMatch(/^\d{4}-\d{2}-03$/);
      expect(snapshots[0]?.refreshCompleted).toBe(true);
    });

    test("資産履歴はスナップショット日を超えず、同日の合計と一致する", async () => {
      const snapshot = await db
        .select()
        .from(schema.dailySnapshots)
        .orderBy(sql`${schema.dailySnapshots.date} DESC`)
        .limit(1)
        .then((rows) => rows.at(0)!);
      expect(snapshot).toBeDefined();

      const futureHistory = await db
        .select({ id: schema.assetHistory.id })
        .from(schema.assetHistory)
        .where(sql`${schema.assetHistory.date} > ${snapshot!.date}`);
      expect(futureHistory).toHaveLength(0);

      const history = await db
        .select()
        .from(schema.assetHistory)
        .where(
          and(
            eq(schema.assetHistory.groupId, snapshot!.groupId),
            eq(schema.assetHistory.date, snapshot!.date),
          ),
        )
        .then((rows) => rows.at(0)!);
      const assetTotal = await db
        .select({ total: sql<number>`SUM(${schema.holdingValues.amount})`.mapWith(Number) })
        .from(schema.holdingValues)
        .innerJoin(schema.holdings, eq(schema.holdingValues.holdingId, schema.holdings.id))
        .where(
          and(eq(schema.holdingValues.snapshotId, snapshot!.id), eq(schema.holdings.type, "asset")),
        )
        .then((rows) => rows.at(0)!);

      expect(history?.totalAssets).toBe(assetTotal?.total);
    });

    test("含み益と含み損の保有資産が存在する", async () => {
      const gains = (
        await db
          .select({ unrealizedGain: schema.holdingValues.unrealizedGain })
          .from(schema.holdingValues)
          .where(isNotNull(schema.holdingValues.unrealizedGain))
      ).map(({ unrealizedGain }) => unrealizedGain!);

      expect(gains.some((gain) => gain > 0)).toBe(true);
      expect(gains.some((gain) => gain < 0)).toBe(true);
    });

    test("暗号資産アカウントと保有資産が存在する", async () => {
      const cryptoAccounts = await db
        .select({ id: schema.accounts.id, name: schema.accounts.name })
        .from(schema.accounts)
        .innerJoin(
          schema.institutionCategories,
          eq(schema.accounts.categoryId, schema.institutionCategories.id),
        )
        .where(eq(schema.institutionCategories.name, "暗号資産・FX・貴金属"));

      expect(cryptoAccounts.length).toBeGreaterThan(0);

      const cryptoHoldings = await db
        .select({
          name: schema.holdings.name,
          amount: schema.holdingValues.amount,
        })
        .from(schema.holdings)
        .innerJoin(
          schema.assetCategories,
          eq(schema.holdings.categoryId, schema.assetCategories.id),
        )
        .innerJoin(schema.holdingValues, eq(schema.holdings.id, schema.holdingValues.holdingId))
        .where(eq(schema.assetCategories.name, "暗号資産"));

      expect(cryptoHoldings.length).toBeGreaterThan(0);
      expect(cryptoHoldings.reduce((sum, h) => sum + h.amount, 0)).toBeGreaterThan(0);
    });

    test("最新の資産履歴に暗号資産カテゴリが含まれる", async () => {
      const targetGroups = await db
        .select()
        .from(schema.groups)
        .where(sql`${schema.groups.name} IN ('グループ選択なし', '投資')`);

      expect(targetGroups).toHaveLength(2);

      for (const group of targetGroups) {
        const latestAssetHistory = await db
          .select()
          .from(schema.assetHistory)
          .where(eq(schema.assetHistory.groupId, group.id))
          .orderBy(sql`${schema.assetHistory.date} DESC`)
          .limit(1)
          .then((rows) => rows.at(0)!);

        expect(latestAssetHistory).toBeDefined();

        const cryptoCategory = await db
          .select()
          .from(schema.assetHistoryCategories)
          .where(
            and(
              eq(schema.assetHistoryCategories.assetHistoryId, latestAssetHistory!.id),
              eq(schema.assetHistoryCategories.categoryName, "暗号資産"),
            ),
          )
          .then((rows) => rows.at(0)!);

        expect(cryptoCategory?.amount).toBeGreaterThan(0);
      }
    });

    test("全グループのholding合計がassetHistoryの最終日と一致する", async () => {
      expect(
        await findRows(`
        WITH latest_history AS (
          SELECT ah.group_id, ah.total_assets
          FROM asset_history ah
          INNER JOIN (
            SELECT group_id, MAX(date) AS date
            FROM asset_history
            GROUP BY group_id
          ) latest ON latest.group_id = ah.group_id AND latest.date = ah.date
        ), holding_totals AS (
          SELECT ga.group_id, SUM(hv.amount) AS total_assets
          FROM group_accounts ga
          INNER JOIN holdings h ON h.account_id = ga.account_id AND h.type = 'asset'
          INNER JOIN holding_values hv ON hv.holding_id = h.id
          GROUP BY ga.group_id
        )
        SELECT g.id
        FROM groups g
        LEFT JOIN latest_history lh ON lh.group_id = g.id
        LEFT JOIN holding_totals ht ON ht.group_id = g.id
        WHERE lh.total_assets IS NULL
           OR ht.total_assets IS NULL
           OR lh.total_assets <> ht.total_assets
      `),
      ).toHaveLength(0);
    });

    test("資産履歴のカテゴリ合計が日次合計と一致する", async () => {
      const mismatches = await db
        .select({ id: schema.assetHistory.id })
        .from(schema.assetHistory)
        .leftJoin(
          schema.assetHistoryCategories,
          eq(schema.assetHistoryCategories.assetHistoryId, schema.assetHistory.id),
        )
        .groupBy(schema.assetHistory.id)
        .having(
          sql`COALESCE(SUM(${schema.assetHistoryCategories.amount}), 0) <> ${schema.assetHistory.totalAssets}`,
        );

      expect(mismatches).toHaveLength(0);
    });

    test("資産履歴のchangeが同じグループの前日差分と一致する", async () => {
      expect(
        await findRows(`
        SELECT id
        FROM (
          SELECT
            id,
            total_assets,
            change,
            LAG(total_assets) OVER (PARTITION BY group_id ORDER BY date) AS previous_total
          FROM asset_history
        ) AS diffed
        WHERE change <> CASE
          WHEN previous_total IS NULL THEN 0
          ELSE total_assets - previous_total
        END
      `),
      ).toHaveLength(0);
    });

    test("資産履歴は全グループで開始日からスナップショット日まで日次連続している", async () => {
      expect(
        await findRows(`
        WITH dated_history AS (
          SELECT
            group_id,
            date,
            LAG(date) OVER (PARTITION BY group_id ORDER BY date) AS previous_date
          FROM asset_history
        )
        SELECT group_id, date
        FROM dated_history
        WHERE previous_date IS NOT NULL
          AND date::date - previous_date::date <> 1
      `),
      ).toHaveLength(0);

      expect(
        await findRows(`
        SELECT g.id
        FROM groups g
        LEFT JOIN (
          SELECT group_id, MIN(date) AS min_date, MAX(date) AS max_date
          FROM asset_history
          GROUP BY group_id
        ) history ON history.group_id = g.id
        CROSS JOIN (SELECT MAX(date) AS snapshot_date FROM daily_snapshots) snapshot
        WHERE history.min_date <> '2025-02-01'
           OR history.max_date <> snapshot.snapshot_date
      `),
      ).toHaveLength(0);
    });

    test("アカウントごとのholdingが存在する", async () => {
      const accounts = await db.select().from(schema.accounts);

      // 携帯・通販など取引のみで資産を持たないアカウントは除外
      const accountsWithExpectedHoldings = accounts.filter(
        (a) => !["ahamo", "Amazon.co.jp"].includes(a.name),
      );

      for (const acc of accountsWithExpectedHoldings) {
        const holdings = await db
          .select()
          .from(schema.holdings)
          .where(eq(schema.holdings.accountId, acc.id));

        expect(holdings.length).toBeGreaterThan(0);
      }
    });
  });

  describe("トランザクション整合性", () => {
    test("取引種別と振替フラグ・計算除外・振替先の組み合わせが正しい", async () => {
      expect(
        await findRows(`
        SELECT id
        FROM transactions
        WHERE type NOT IN ('income', 'expense', 'transfer')
           OR (type = 'transfer') <> is_transfer
           OR (type = 'transfer' AND NOT is_excluded_from_calculation)
           OR (type = 'transfer' AND (transfer_target IS NULL OR transfer_target_account_id IS NULL))
           OR (type <> 'transfer' AND (is_transfer OR transfer_target IS NOT NULL OR transfer_target_account_id IS NOT NULL))
      `),
      ).toHaveLength(0);
    });

    test("取引金額は正数でスナップショット日を超えない", async () => {
      expect(
        await findRows(`
        SELECT id
        FROM transactions
        WHERE amount <= 0
           OR date > (SELECT MAX(date) FROM daily_snapshots)
      `),
      ).toHaveLength(0);
    });

    test("収入・支出トランザクションにカテゴリが設定されている", async () => {
      const incomeExpense = await db
        .select()
        .from(schema.transactions)
        .where(sql`${schema.transactions.type} IN ('income', 'expense')`);

      for (const tx of incomeExpense) {
        expect(tx.category).not.toBeNull();
      }
    });

    test("振替トランザクションはisExcludedFromCalculation=trueである", async () => {
      const transfers = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.type, "transfer"));

      for (const tx of transfers) {
        expect(tx.isExcludedFromCalculation).toBe(true);
      }
    });

    test("月次データが連続している", async () => {
      const months = (
        await db
          .select({ month: sql<string>`SUBSTR(${schema.transactions.date}, 1, 7)` })
          .from(schema.transactions)
          .groupBy(sql`SUBSTR(${schema.transactions.date}, 1, 7)`)
          .orderBy(sql`SUBSTR(${schema.transactions.date}, 1, 7)`)
      ).map((m) => m.month);

      expect(months.length).toBeGreaterThan(0);

      // 月が連続しているか確認
      for (let i = 1; i < months.length; i++) {
        const prev = new Date(`${months[i - 1]}-01`);
        const curr = new Date(`${months[i]}-01`);

        // 次の月か確認
        prev.setMonth(prev.getMonth() + 1);
        expect(prev.toISOString().slice(0, 7)).toBe(curr.toISOString().slice(0, 7));
      }
    });
  });

  describe("予算設定", () => {
    test("生活グループとグループ選択なしに予算が設定されている", async () => {
      const groups = await db
        .select()
        .from(schema.groups)
        .where(sql`${schema.groups.name} IN ('グループ選択なし', '生活')`);

      for (const group of groups) {
        const targets = await db
          .select()
          .from(schema.spendingTargets)
          .where(eq(schema.spendingTargets.groupId, group.id));

        expect(targets.length).toBeGreaterThan(0);
      }
    });

    test("投資グループには予算が設定されていない", async () => {
      const investmentGroup = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.name, "投資"))
        .then((rows) => rows.at(0)!);

      expect(investmentGroup).toBeDefined();

      const targets = await db
        .select()
        .from(schema.spendingTargets)
        .where(eq(schema.spendingTargets.groupId, investmentGroup!.id));

      expect(targets).toHaveLength(0);
    });
  });

  describe("マスター整合性", () => {
    test("全アカウントに有効なステータスが1件ずつ存在する", async () => {
      expect(
        await findRows(`
        SELECT a.id
        FROM accounts a
        LEFT JOIN account_statuses s ON s.account_id = a.id
        GROUP BY a.id
        HAVING COUNT(s.id) <> 1
           OR SUM(CASE WHEN s.status IN ('ok', 'error', 'updating', 'suspended', 'unknown') THEN 0 ELSE 1 END) <> 0
      `),
      ).toHaveLength(0);
    });

    test("holdingの種別とカテゴリが矛盾せず評価額が負でない", async () => {
      expect(
        await findRows(`
        SELECT h.id
        FROM holdings h
        LEFT JOIN holding_values hv ON hv.holding_id = h.id
        WHERE h.type NOT IN ('asset', 'liability')
           OR (h.type = 'asset' AND h.category_id IS NULL)
           OR (h.type = 'liability' AND h.liability_category IS NULL)
           OR hv.id IS NULL
           OR hv.amount < 0
      `),
      ).toHaveLength(0);
    });

    test("予算種別は許可値のみである", async () => {
      expect(
        await findRows(`
        SELECT id
        FROM spending_targets
        WHERE type NOT IN ('fixed', 'variable')
      `),
      ).toHaveLength(0);
    });
  });

  describe("分析レポート整合性", () => {
    test("全グループにスナップショット日付のdemoレポートが存在する", async () => {
      expect(
        await findRows(`
        SELECT g.id
        FROM groups g
        LEFT JOIN analytics_reports ar ON ar.group_id = g.id
        CROSS JOIN (SELECT MAX(date) AS snapshot_date FROM daily_snapshots) snapshot
        GROUP BY g.id, snapshot.snapshot_date
        HAVING COUNT(ar.id) <> 1
           OR MAX(ar.date) <> snapshot.snapshot_date
           OR COALESCE(MAX(ar.model), '') <> 'demo'
      `),
      ).toHaveLength(0);
    });

    test("分析レポートに少なくとも1つのインサイトがある", async () => {
      expect(
        await findRows(`
        SELECT id
        FROM analytics_reports
        WHERE NULLIF(TRIM(summary), '') IS NULL
          AND NULLIF(TRIM(savings_insight), '') IS NULL
          AND NULLIF(TRIM(investment_insight), '') IS NULL
          AND NULLIF(TRIM(spending_insight), '') IS NULL
          AND NULLIF(TRIM(balance_insight), '') IS NULL
          AND NULLIF(TRIM(liability_insight), '') IS NULL
      `),
      ).toHaveLength(0);
    });
  });
});
