# 金融機関の一括更新を開始するだけの Lambda。
#
# Lambda の Node ベースイメージ (Amazon Linux) は使わない。Playwright の
# `install --with-deps` が Debian/Ubuntu しか面倒を見ないため、AL2023 では
# 共有ライブラリを手で並べることになり、増減に静かに壊れる。crawler と
# 同じ Debian ベースに揃えて、同じ手順で Chromium を入れる。
#
# その代わり Lambda のランタイム API を自分で話す必要があるので、
# Runtime Interface Client を別の段でビルドして持ち込む。

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
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/pnpm:$PATH \
    # Lambda で書けるのは /tmp だけ。Chromium も認証状態もここへ寄せる。
    HOME=/tmp

RUN mkdir -p /pnpm \
    && npm install -g corepack@latest \
    && corepack enable \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/bulk-refresh/package.json ./apps/bulk-refresh/
COPY apps/crawler/package.json ./apps/crawler/
COPY packages/db/package.json ./packages/db/
COPY packages/date-utils/package.json ./packages/date-utils/
COPY packages/meta/package.json ./packages/meta/
COPY packages/analytics/package.json ./packages/analytics/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --prod --filter "@mf-dashboard/bulk-refresh..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/bulk-refresh..." \
    && pnpm --filter "@mf-dashboard/bulk-refresh" exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /pnpm/store /var/lib/apt/lists/*

# RIC は自身の依存も要るので node_modules ごと持ち込む。
# /opt/node_modules に置けば Node の既定の探索でそのまま解決される。
COPY --from=ric /ric/node_modules /opt/node_modules

COPY . .

# tsx は --import の解決を作業ディレクトリから行うため、パッケージの中に入る。
# LAMBDA_TASK_ROOT も揃えて、ハンドラをここからの相対で指定できるようにする。
WORKDIR /app/apps/bulk-refresh
ENV LAMBDA_TASK_ROOT=/app/apps/bulk-refresh

# ハンドラは TypeScript のままなので tsx を挟む。crawler と同じ形。
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--import", "tsx", "/opt/node_modules/aws-lambda-ric/index.mjs"]
CMD ["src/lambda.handler"]
