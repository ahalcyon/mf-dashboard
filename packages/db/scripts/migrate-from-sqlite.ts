/**
 * SQLite (旧 data/moneyforward.db) から PostgreSQL への一回きりのデータ移行スクリプト
 *
 * 移行先は通常のDB解決と同じ:
 * - DATABASE_URL が設定されていればリモートPostgreSQL (AWS RDSなど)
 * - なければ DB_PATH (既定 data/moneyforward-db) のPGlite
 *
 * 使い方:
 *   # RDSへ移行
 *   DATABASE_URL=postgres://... pnpm --filter @mf-dashboard/db migrate:from-sqlite
 *
 *   # 旧ファイルの場所を指定
 *   SQLITE_PATH=/path/to/moneyforward.db DATABASE_URL=... pnpm --filter @mf-dashboard/db migrate:from-sqlite
 *
 *   # 移行先に既存データがある場合は --truncate で全テーブルを削除してから移行
 *   DATABASE_URL=... pnpm --filter @mf-dashboard/db migrate:from-sqlite -- --truncate
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@libsql/client";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { closeDb, initDb, schema, type Db } from "../src/index";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { truncate: { type: "boolean", default: false } },
  strict: false,
});

const sqlitePath =
  process.env.SQLITE_PATH || join(import.meta.dirname, "..", "..", "..", "data", "moneyforward.db");

if (!existsSync(sqlitePath)) {
  console.error(`移行元のSQLiteファイルが見つかりません: ${sqlitePath}`);
  console.error("SQLITE_PATH で場所を指定してください。");
  process.exit(1);
}

// FK依存順（親→子）。truncateは逆順で行う。
const TABLES_IN_DEPENDENCY_ORDER: PgTable[] = [
  schema.groups,
  schema.institutionCategories,
  schema.assetCategories,
  schema.accounts,
  schema.groupAccounts,
  schema.accountStatuses,
  schema.holdings,
  schema.dailySnapshots,
  schema.holdingValues,
  schema.transactions,
  schema.cashFlowPeriods,
  schema.bankForecastDismissals,
  schema.bankForecastManualEvents,
  schema.assetHistory,
  schema.assetHistoryCategories,
  schema.spendingTargets,
  schema.analyticsReports,
];

const INSERT_BATCH_SIZE = 500;

function convertValue(columnType: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  // SQLiteのbooleanは0/1で格納されている
  if (columnType === "PgBoolean") return value === 1 || value === true;
  return value;
}

async function assertTargetIsEmpty(db: Db): Promise<void> {
  const result = (await db.execute(sql`SELECT COUNT(*) AS count FROM groups`)) as unknown as {
    rows: Array<{ count: number | string }>;
  };
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    console.error("移行先に既存データがあります。--truncate を付けて再実行してください。");
    process.exit(1);
  }
}

async function truncateAllTables(db: Db): Promise<void> {
  for (const table of [...TABLES_IN_DEPENDENCY_ORDER].reverse()) {
    await db.delete(table);
  }
  console.log("移行先の既存データを削除しました");
}

const sqlite = createClient({ url: `file:${sqlitePath}` });
const db = await initDb();

if (args.truncate) {
  await truncateAllTables(db);
} else {
  await assertTargetIsEmpty(db);
}

for (const table of TABLES_IN_DEPENDENCY_ORDER) {
  const tableName = getTableName(table);
  const columns = getTableColumns(table);
  const result = await sqlite.execute(`SELECT * FROM "${tableName}"`);

  const records = result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const [tsKey, column] of Object.entries(columns)) {
      record[tsKey] = convertValue(column.columnType, row[column.name]);
    }
    return record;
  });

  for (let offset = 0; offset < records.length; offset += INSERT_BATCH_SIZE) {
    await db.insert(table).values(records.slice(offset, offset + INSERT_BATCH_SIZE));
  }

  // 明示ID挿入後にidentityシーケンスを進める
  const hasIdentityId = Object.values(columns).some(
    (column) => column.name === "id" && column.dataType === "number",
  );
  if (hasIdentityId) {
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence(${tableName}, 'id'), COALESCE((SELECT MAX(id) FROM ${sql.raw(`"${tableName}"`)}), 0) + 1, false)`,
    );
  }

  console.log(`${tableName}: ${records.length}件を移行しました`);
}

sqlite.close();
await closeDb();
console.log(
  `\n移行が完了しました: ${sqlitePath} → ${process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "PGlite"}`,
);
