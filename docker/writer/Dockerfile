# esbuild で単一ファイルへまとめる。Lambda のランタイムは TypeScript を
# そのまま解決できず、pnpm の isolated な node_modules も持ち込みにくいため。
FROM node:26.7.0-bookworm-slim AS builder
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PATH=/pnpm:$PATH

# Node 25 以降 corepack はイメージへ同梱されない
RUN mkdir -p /pnpm && npm install -g corepack@latest && corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/writer/package.json ./apps/writer/
COPY packages/db/package.json ./packages/db/
COPY packages/date-utils/package.json ./packages/date-utils/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --filter "@mf-dashboard/writer..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/writer..."

COPY tsconfig.json ./
COPY apps/writer ./apps/writer
COPY packages/db ./packages/db
COPY packages/date-utils ./packages/date-utils

RUN pnpm --filter @mf-dashboard/writer bundle

FROM public.ecr.aws/lambda/nodejs:22

# @libsql/client はネイティブバイナリを持つためバンドルせず、
# 実行環境のプラットフォームに合わせてここで解決する。
ARG LIBSQL_CLIENT_VERSION=0.17.4
RUN npm install --omit=dev --no-package-lock "@libsql/client@${LIBSQL_CLIENT_VERSION}" \
    && npm cache clean --force

COPY --from=builder /app/apps/writer/dist/index.mjs ${LAMBDA_TASK_ROOT}/index.mjs
# handler は MIGRATIONS_DIR (既定 /var/task/drizzle) を見る
COPY --from=builder /app/packages/db/drizzle ${LAMBDA_TASK_ROOT}/drizzle

CMD ["index.handler"]
