# S3 のデータベースが更新されたら、その中身を焼き込んだ静的サイトを発行する。
# デプロイは手元から行う方針なので、ソースは GitHub から取らずイメージへ同梱する。
FROM node:26.7.0-bookworm-slim
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PATH=/pnpm:$PATH \
    HOME=/tmp

# Content-Type の推定と --delete の意味論を自前で持ちたくないので aws-cli を使う
RUN mkdir -p /pnpm \
    && npm install -g corepack@latest \
    && corepack enable \
    && apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/date-utils/package.json ./packages/date-utils/
COPY packages/meta/package.json ./packages/meta/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --filter "@mf-dashboard/web..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/web..." \
    && rm -rf /pnpm/store

COPY . .

# next build と aws s3 sync は書き込み先を必要とする
RUN chmod -R a+w /app/apps/web /app/data

ENTRYPOINT ["/usr/bin/tini", "--", "node", "scripts/publish-site.mjs"]
