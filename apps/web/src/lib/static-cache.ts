/**
 * 静的エクスポートのビルド中だけ、同じ入力に対する結果をモジュールスコープに
 * 保持して使い回す。`next dev` と standalone サーバーでは元の関数をそのまま呼ぶ。
 */
export function memoizeDuringStaticExport<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  buildKey: (...args: Args) => string,
): (...args: Args) => Promise<Result> {
  const cache = new Map<string, Promise<Result>>();

  return (...args: Args) => {
    if (process.env.STATIC_EXPORT !== "true") return fn(...args);

    const key = buildKey(...args);
    const cached = cache.get(key);
    if (cached) return cached;

    const pending = fn(...args);
    cache.set(key, pending);
    // 失敗した結果は残さない。
    pending.catch(() => cache.delete(key));
    return pending;
  };
}
