import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // terraform は publish:site が output を読むために呼ぶ。開発者が各自で入れる前提。
  ignoreBinaries: ["ps", "terraform"],
  ignoreDependencies: ["lefthook"],
  workspaces: {
    ".": {
      // package.json のスクリプトからではなく terraform の apply 中に呼ばれる
      entry: ["scripts/image-source-hash.mjs", "scripts/publish-image.mjs"],
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
