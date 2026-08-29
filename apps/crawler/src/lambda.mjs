// Runtime Interface Client が探すのは .mjs / .js / .cjs だけで、.ts は候補に
// 入らない。ENTRYPOINT の `node --import tsx` はすでに登録済みなので、
// ここを入口にすれば TypeScript のまま読み込める。bulk-refresh と同じ形。
export { handler } from "./lambda.ts";
