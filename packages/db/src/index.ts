import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { getDatabaseUrl, getDbPath } from "./db-path";

// node-postgresはint8(SUM/COUNTなど)とnumericをstringで返すため、
// PGliteと同じくnumberへ揃える（本アプリの金額は2^53未満）
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

const { Pool } = pg;
import * as schema from "./schema/schema";

/**
 * 接続先はどちらもPostgreSQL:
 * - DATABASE_URL が設定されていればnode-postgres（AWS RDSなどのリモートPostgreSQL）
 * - 未設定ならPGlite（data/ 以下のローカル組込みPostgres。デモ・ローカル開発用）
 */
export type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DbTransaction = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DbExecutor = Db | DbTransaction;

let _db: Db | null = null;
let _nodePgDb: NodePgDatabase<typeof schema> | null = null;
let _pgliteDb: PgliteDatabase<typeof schema> | null = null;
let _pool: pg.Pool | null = null;
let _pglite: PGlite | null = null;

export function isDatabaseAvailable(): boolean {
  if (getDatabaseUrl()) {
    return true;
  }
  return existsSync(getDbPath());
}

export function getDb(): Db {
  if (!_db) {
    const databaseUrl = getDatabaseUrl();
    if (databaseUrl) {
      _pool = new Pool({ connectionString: databaseUrl });
      _nodePgDb = drizzleNodePg(_pool, { schema });
      _db = _nodePgDb as Db;
    } else {
      _pglite = new PGlite(getDbPath());
      _pgliteDb = drizzlePglite(_pglite, { schema });
      _db = _pgliteDb as Db;
    }
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
  }
  if (_pglite) {
    await _pglite.close();
  }
  _pool = null;
  _pglite = null;
  _nodePgDb = null;
  _pgliteDb = null;
  _db = null;
}

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../drizzle");

export async function initDb(): Promise<Db> {
  const db = getDb();

  // Apply migrations
  if (_nodePgDb) {
    await migrateNodePg(_nodePgDb, { migrationsFolder: MIGRATIONS_FOLDER });
  } else if (_pgliteDb) {
    await migratePglite(_pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  return db;
}

export { schema };

// Shared utilities
export * from "./shared/group-filter";
export * from "./shared/transfer";
export * from "./shared/utils";

// Query modules
export * from "./queries/groups";
export * from "./queries/transaction";
export * from "./queries/summary";
export * from "./queries/account";
export * from "./queries/asset";
export * from "./queries/holding";
export * from "./queries/analytics";
