export interface SyncConfig {
  bucket: string;
  queueUrl: string;
  messageGroupId: string;
  databaseObjectKey: string;
}

/**
 * AWS 上で動くときだけ同期経路を使う。
 * ローカル実行や CI では従来どおりローカルの SQLite だけを扱う。
 */
export function loadSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig | null {
  const bucket = env.DATA_BUCKET?.trim();
  const queueUrl = env.WRITE_QUEUE_URL?.trim();
  if (!bucket || !queueUrl) return null;

  return {
    bucket,
    queueUrl,
    messageGroupId: env.WRITE_MESSAGE_GROUP_ID?.trim() || "sqlite-write",
    databaseObjectKey: env.DATABASE_OBJECT_KEY?.trim() || "db/moneyforward.db",
  };
}

/** 1 回のクロールを識別する。ペイロードの S3 キーにも使う。 */
export function buildRunId(now: Date = new Date()): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}
