# クロールのイメージ。1 つで 2 通りに起動する。
#
#   Lambda  定期クロール。この Dockerfile の ENTRYPOINT（Runtime Interface Client）
#   ECS     バックフィル（history モード）。タスク定義が entryPoint を CLI に上書きする
#
# 分けないのは、バックフィルと定期クロールが違う Chromium で描画するのを
# 避けるため。selector はレンダリングに依存するので、ここがずれると
# 片方だけ静かに壊れる。
#
# Lambda の Node ベースイメージ (Amazon Linux) を使わない理由は
# docker/bulk-refresh/Dockerfile と同じ。Playwright の `install --with-deps` が
# Debian/Ubuntu しか面倒を見ない。

# --- RIC はネイティブビルドを伴うのでビルド用の段で作る ---
FROM node:26.7.0-bookworm-slim AS ric
RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf \
      automake \
      build-essential \
      cmake \
      libcurl4-openssl-dev \
      libtool \
      python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /ric
RUN npm install --no-audit --no-fund aws-lambda-ric@4.0.2

# --- 実行用 ---
FROM node:26.7.0-bookworm-slim
# Lambda は実行時に LAMBDA_TASK_ROOT を /var/task へ固定する。予約された
# 環境変数なのでイメージの ENV では上書きできない。
WORKDIR /var/task
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/pnpm:$PATH \
    # Lambda で書けるのは /tmp だけ。ECS でも同じで困らない。
    HOME=/tmp

RUN mkdir -p /pnpm \
    && npm install -g corepack@latest \
    && corepack enable \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/crawler/package.json ./apps/crawler/
COPY packages/db/package.json ./packages/db/
COPY packages/date-utils/package.json ./packages/date-utils/
COPY packages/meta/package.json ./packages/meta/
COPY packages/analytics/package.json ./packages/analytics/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --prod --filter "@mf-dashboard/crawler..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/crawler..." \
    && pnpm --filter "@mf-dashboard/crawler" exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /pnpm/store /var/lib/apt/lists/*

# RIC は自身の依存も要るので node_modules ごと持ち込む。
# /opt/node_modules に置けば Node の既定の探索でそのまま解決される。
COPY --from=ric /ric/node_modules /opt/node_modules

COPY . .

# tsx は --import の解決を作業ディレクトリから行うため、パッケージの中に入る。
# ハンドラのほうは LAMBDA_TASK_ROOT (/var/task) からの相対で指定する。
WORKDIR /var/task/apps/crawler

# 既定は Lambda。ECS のタスク定義は entryPoint を
# ["/usr/bin/tini","--","node","--import","tsx","src/index.ts"] に上書きする。
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "tsx", "/opt/node_modules/aws-lambda-ric/index.mjs"]
CMD ["apps/crawler/src/lambda.handler"]
