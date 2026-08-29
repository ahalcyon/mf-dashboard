import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // terraform は publish:site が output を読むために呼ぶ。開発者が各自で入れる前提。
  ignoreBinaries: ["terraform"],
  // CloudFront Functions のソース。JS からは import されず、terraform の
  // templatefile が読んでエッジへ配る。テストは中身をテキストとして読む。
  ignore: ["terraform/aws/functions/*.js"],
  workspaces: {
    ".": {
      // package.json のスクリプトからではなく terraform の apply 中に呼ばれる
      entry: ["scripts/image-source-hash.mjs", "scripts/publish-image.mjs"],
    },
    "apps/web": {
      // playwright.config.ts が webServer のコマンド文字列から呼ぶ。
      entry: ["scripts/require-demo-db.mjs"],
    },
    "apps/bulk-refresh": {
      // Lambda のハンドラを名指しするのは Dockerfile の CMD で、コードからは
      // 誰も import しない。entry に挙げないと knip が export を落とし、
      // Lambda が "handler is undefined" で起動に失敗する。実際に踏んだ。
      entry: ["src/handler.ts"],
      // 同じ理由で tsx を呼ぶのも ENTRYPOINT だけ。外すとハンドラを読めない。
      ignoreDependencies: ["tsx"],
    },
    "apps/crawler": {
      ignore: ["src/hooks/helpers.ts"],
    },
    "packages/db": {
      entry: ["src/migrate.ts"],
    },
  },
};

export default config;
