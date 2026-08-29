// Runtime Interface Client が探すのは .mjs / .js / .cjs だけで、.ts は候補に
// 入らない。ENTRYPOINT の `node --import tsx` はすでに登録済みなので、
// ここを入口にすれば TypeScript のまま読み込める。
//
// esbuild で束ねない理由は、クロール本体を Lambda へ移すとき (#93 の ④) に
// @mf-dashboard/db のネイティブ依存ごと束ねることになり、そちらのほうが
// 手に負えないため。読み込み方を 1 つに揃えておく。
export { handler } from "./handler.ts";
