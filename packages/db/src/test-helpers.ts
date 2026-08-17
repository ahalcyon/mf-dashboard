import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./index";
import * as schema from "./schema/schema";

/**
 * テスト用 DB（インメモリPGlite）を作成し、マイグレーションを適用して返す。
 * dataDirを渡すとファイル永続化されたPGliteを検証できる。
 * beforeAll で1回だけ呼び出し、テスト間は resetTestDb でデータをクリアする。
 */
export async function createTestDb(dataDir?: string): Promise<Db> {
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });

  // マイグレーション適用
  await migrate(db, {
    migrationsFolder: join(import.meta.dirname, "../drizzle"),
  });

  return db as Db;
}

/**
 * 全テーブルのデータをクリアする。
 * beforeEach で呼び出してテスト間の分離を保証する。
 */
export async function resetTestDb(db: Db): Promise<void> {
  // FK の依存順に削除
  await db.delete(schema.holdingValues);
  await db.delete(schema.dailySnapshots);
  await db.delete(schema.holdings);
  await db.delete(schema.accountStatuses);
  await db.delete(schema.transactions);
  await db.delete(schema.cashFlowPeriods);
  await db.delete(schema.bankForecastManualEvents);
  await db.delete(schema.bankForecastDismissals);
  await db.delete(schema.assetHistoryCategories);
  await db.delete(schema.assetHistory);
  await db.delete(schema.spendingTargets);
  await db.delete(schema.groupAccounts);
  await db.delete(schema.accounts);
  await db.delete(schema.groups);
  await db.delete(schema.assetCategories);
  await db.delete(schema.institutionCategories);
}

/** テスト用グループ ID */
export const TEST_GROUP_ID = "test_group_001";

/**
 * テスト用グループを作成する。
 */
export async function createTestGroup(db: Db): Promise<string> {
  const now = new Date().toISOString();
  await db.insert(schema.groups).values({
    id: TEST_GROUP_ID,
    name: "Test Group",
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
  });
  return TEST_GROUP_ID;
}

/**
 * テスト用 DB の接続を閉じる。afterAll で呼び出す。
 */
export async function closeTestDb(db: Db): Promise<void> {
  await (db as unknown as { $client: PGlite }).$client.close();
}
