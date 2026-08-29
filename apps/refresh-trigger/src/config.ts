export interface RefreshTriggerConfig {
  cluster: string;
  taskDefinition: string;
  subnets: string[];
  securityGroups: string[];
  bulkRefreshFunction: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function requiredList(name: string): string[] {
  const values = required(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must not be empty`);
  return values;
}

export function loadConfig(): RefreshTriggerConfig {
  return {
    cluster: required("ECS_CLUSTER"),
    taskDefinition: required("CRAWLER_TASK_DEFINITION"),
    subnets: requiredList("SUBNET_IDS"),
    securityGroups: requiredList("SECURITY_GROUP_IDS"),
    bulkRefreshFunction: required("BULK_REFRESH_FUNCTION"),
  };
}
