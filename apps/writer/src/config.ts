export interface WriterConfig {
  dataBucket: string;
  databaseObjectKey: string;
  databaseLocalPath: string;
  migrationsDir: string;
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
  };
}
