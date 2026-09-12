export interface RefreshTriggerConfig {
  crawlFunction: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export function loadConfig(): RefreshTriggerConfig {
  return {
    crawlFunction: required("CRAWL_FUNCTION"),
  };
}
