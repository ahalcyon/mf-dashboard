export interface WriterConfig {
  dataBucket: string;
  databaseObjectKey: string;
  databaseLocalPath: string;
  migrationsDir: string;
  eventBusName: string;
  crawlCompletedSource: string;
  crawlCompletedDetailType: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export function loadConfig(): WriterConfig {
  return {
    dataBucket: required("DATA_BUCKET"),
    databaseObjectKey: required("DATABASE_OBJECT_KEY"),
    // Lambda で書き込めるのは /tmp だけ
    databaseLocalPath: process.env.DATABASE_LOCAL_PATH?.trim() || "/tmp/moneyforward.db",
    migrationsDir: process.env.MIGRATIONS_DIR?.trim() || "/var/task/drizzle",
    // イベントの名前は Terraform 側のルールと一致していなければならない。
    // 既定値を持たせるとずれても動いてしまい、再ビルドだけが静かに止まる。
    eventBusName: required("EVENT_BUS_NAME"),
    crawlCompletedSource: required("CRAWL_COMPLETED_SOURCE"),
    crawlCompletedDetailType: required("CRAWL_COMPLETED_DETAIL_TYPE"),
  };
}
