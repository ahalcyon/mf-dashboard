import { debug } from "../logger.js";
import { generateTotp, secondsUntilNextWindow } from "./totp.js";

interface Credentials {
  username: string;
  password: string;
}

type SecretKey = "username" | "password" | "totpSecret";

const ENV_KEYS: Record<SecretKey, string> = {
  username: "MF_EMAIL",
  password: "MF_PASSWORD",
  totpSecret: "MF_TOTP_SECRET",
};

const PARAMETER_SUFFIXES: Record<SecretKey, string> = {
  username: "email",
  password: "password",
  totpSecret: "totp-secret",
};

const DEFAULT_PARAMETER_PREFIX = "/mf-dashboard";

/**
 * 生成したコードがフォーム送信中に失効するのを避けるための下限。
 * これを下回る場合は次の窓が始まるまで待ってから生成し直す。
 */
const MIN_REMAINING_SECONDS = 3;

let cache: Partial<Record<SecretKey, string>> = {};

function getParameterPrefix(): string {
  const configured = process.env.SSM_PARAMETER_PREFIX?.trim() || DEFAULT_PARAMETER_PREFIX;
  return configured.endsWith("/") ? configured.slice(0, -1) : configured;
}

function parameterNameFor(key: SecretKey): string {
  return `${getParameterPrefix()}/${PARAMETER_SUFFIXES[key]}`;
}

/**
 * SSM Parameter Store から SecureString をまとめて取得する。
 *
 * ECS では タスク定義の secrets が同じ値を環境変数として注入するため、
 * この経路を通るのはローカル実行時だけになる。
 */
async function resolveFromParameterStore(keys: SecretKey[]): Promise<void> {
  // 環境変数だけで完結する場合に AWS SDK を読み込まないよう、遅延 import する
  const { SSMClient, GetParametersCommand } = await import("@aws-sdk/client-ssm");

  const nameToKey = new Map(keys.map((key) => [parameterNameFor(key), key]));
  debug(`Resolving ${keys.length} secret(s) from SSM Parameter Store...`);

  const client = new SSMClient({});
  try {
    const response = await client.send(
      new GetParametersCommand({
        Names: [...nameToKey.keys()],
        WithDecryption: true,
      }),
    );

    for (const parameter of response.Parameters ?? []) {
      const key = parameter.Name ? nameToKey.get(parameter.Name) : undefined;
      if (key && parameter.Value) {
        cache[key] = parameter.Value;
      }
    }

    const missing = response.InvalidParameters ?? [];
    if (missing.length > 0) {
      throw new Error(
        `SSM parameters not found: ${missing.join(", ")}. ` +
          `Create them as SecureString, or set ${keys.map((key) => ENV_KEYS[key]).join(" / ")} instead.`,
      );
    }
  } finally {
    client.destroy();
  }
}

/**
 * 環境変数を優先し、足りない分だけ SSM から解決する。
 *
 * ローカルは .env、CI は環境変数、AWS はタスク定義経由の注入と、
 * 実行場所ごとに呼び出し側を変えずに済ませるための順序。
 */
async function resolveSecrets(keys: SecretKey[]): Promise<Record<SecretKey, string>> {
  for (const key of keys) {
    const fromEnv = process.env[ENV_KEYS[key]]?.trim();
    if (fromEnv) {
      cache[key] = fromEnv;
    }
  }

  const missing = keys.filter((key) => !cache[key]);
  if (missing.length > 0) {
    await resolveFromParameterStore(missing);
  }

  const resolved = {} as Record<SecretKey, string>;
  for (const key of keys) {
    const value = cache[key];
    if (!value) {
      throw new Error(`Failed to resolve ${ENV_KEYS[key]} from the environment or SSM`);
    }
    resolved[key] = value;
  }
  return resolved;
}

export async function getCredentials(): Promise<Credentials> {
  const { username, password } = await resolveSecrets(["username", "password"]);
  return { username, password };
}

export async function getOTP(): Promise<string> {
  const { totpSecret } = await resolveSecrets(["totpSecret"]);

  const remainingSeconds = secondsUntilNextWindow();
  if (remainingSeconds < MIN_REMAINING_SECONDS) {
    debug("TOTP window is about to roll over, waiting for the next one...");
    await new Promise((resolve) => setTimeout(resolve, remainingSeconds * 1000 + 500));
  }

  debug("Generating TOTP...");
  return generateTotp(totpSecret);
}

/**
 * テスト用: 解決済みの値を破棄する
 */
export function _resetCredentialsCache(): void {
  cache = {};
}
