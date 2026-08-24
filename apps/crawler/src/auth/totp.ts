import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_ALGORITHM = "sha1";

export interface TotpOptions {
  /** 生成時刻。テストで固定するために差し替える */
  timestampMs?: number;
  digits?: number;
  periodSeconds?: number;
  algorithm?: "sha1" | "sha256" | "sha512";
}

/**
 * 認証アプリが表示するセットアップキー（Base32）をバイト列へ変換する。
 * 見た目を整えるための空白とハイフン、末尾のパディングは許容する。
 */
export function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();

  if (!normalized) {
    throw new Error("TOTP secret is empty");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error("TOTP secret contains a character outside the Base32 alphabet");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

/**
 * RFC 6238 の TOTP を生成する。
 *
 * 認証アプリと同じ計算をローカルで行うため、シークレットさえ持っていれば
 * 外部サービスへの問い合わせなしにコードを得られる。
 */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const {
    timestampMs = Date.now(),
    digits = DEFAULT_DIGITS,
    periodSeconds = DEFAULT_PERIOD_SECONDS,
    algorithm = DEFAULT_ALGORITHM,
  } = options;

  if (digits < 1 || digits > 10) {
    throw new Error("TOTP digits must be between 1 and 10");
  }
  if (periodSeconds <= 0) {
    throw new Error("TOTP period must be positive");
  }

  const counter = BigInt(Math.floor(timestampMs / 1000 / periodSeconds));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);

  const digest = createHmac(algorithm, decodeBase32(secret)).update(counterBytes).digest();

  // RFC 4226 dynamic truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * 生成直後のコードが有効期限切れ間際でないかを判定する。
 * ログイン操作に数秒かかるため、残り時間が短いときは次の窓を待つ判断に使う。
 */
export function secondsUntilNextWindow(
  timestampMs: number = Date.now(),
  periodSeconds: number = DEFAULT_PERIOD_SECONDS,
): number {
  const elapsed = Math.floor(timestampMs / 1000) % periodSeconds;
  return periodSeconds - elapsed;
}
