import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * リモートPostgreSQL（AWS RDSなど）の接続文字列。
 * 設定されている場合はPGliteではなくnode-postgresで接続する。
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}

/**
 * ローカルPGliteのデータディレクトリを解決する。
 * DB_PATHが設定されていればそれを使用し、なければ data/moneyforward-db を探す。
 */
export function getDbPath(): string {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  const cwdDataDir = join(process.cwd(), "data");
  if (existsSync(cwdDataDir)) {
    return join(cwdDataDir, "moneyforward-db");
  }

  const rootDataDir = join(process.cwd(), "..", "..", "data");
  if (existsSync(rootDataDir)) {
    return join(rootDataDir, "moneyforward-db");
  }

  return join(cwdDataDir, "moneyforward-db");
}
