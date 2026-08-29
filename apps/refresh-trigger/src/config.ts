export interface RefreshTriggerConfig {
  bulkRefreshFunction: string;
  crawlFunction: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export function loadConfig(): RefreshTriggerConfig {
  return {
    bulkRefreshFunction: required("BULK_REFRESH_FUNCTION"),
    crawlFunction: required("CRAWL_FUNCTION"),
  };
}
