// E2E の web サーバーを起動する前に、デモデータベースがあることを確かめる。
//
// `pnpm test:e2e:web` は turbo の `^build:demo` で data/demo.db を作ってから
// playwright を呼ぶ。`playwright test` を直接叩くとその段階が飛び、全ページが
// `no such table: groups` で 500 になる。原因が分かる形で早く落とす。
//
// この確認を playwright.config.ts の読み込み時に置くと、設定を読むだけの
// ツール（knip など）まで巻き込んで落ちる。サーバーを起動する瞬間に限る。
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoDbPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/demo.db");

if (!existsSync(demoDbPath)) {
  console.error(
    [
      `デモデータベースが見つかりません: ${demoDbPath}`,
      "E2E は `pnpm test:e2e:web` から実行してください。turbo の `^build:demo` が data/demo.db を生成します。",
      "`playwright test` を直接起動すると生成が飛ばされ、全ページが `no such table: groups` で 500 になります。",
    ].join("\n"),
  );
  process.exit(1);
}
