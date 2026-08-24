import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // terraform は publish:site が output を読むために呼ぶ。開発者が各自で入れる前提。
  ignoreBinaries: ["ps", "terraform"],
  ignoreDependencies: ["lefthook"],
  workspaces: {
    "apps/crawler": {
      ignore: ["src/hooks/helpers.ts"],
    },
    "apps/web": {
      entry: ["e2e/mock-crawler-server.ts"],
    },
    "packages/db": {
      entry: ["src/migrate.ts"],
    },
  },
};

export default config;
