/**
 * 静的エクスポートのビルド中だけ、同じ入力に対する結果を使い回す。
 *
 * React の `cache()` はレンダー単位のため、ページをまたいでは効かない。出力は
 * 80 ページを超えるので、全ページに出る要素が重いクエリを持つと同じ計算がその
 * 回数だけ走る。静的エクスポートでは入力が同じなら結果も同じなので、ビルド中に
 * 限ってモジュールスコープに持つ。
 *
 * `next dev` と standalone サーバーではリクエストごとにデータが変わりうるため、
 * 何もせず元の関数をそのまま呼ぶ。
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
    // 失敗した結果は残さない。静的ビルドはそのまま失敗するが、dev で
    // STATIC_EXPORT を立てて試したときに一度の失敗が固定化するのを避ける。
    pending.catch(() => cache.delete(key));
    return pending;
  };
}
