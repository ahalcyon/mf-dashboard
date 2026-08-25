# writer と同じく esbuild で単一ファイルにまとめる。
# Lambda のランタイムは TypeScript を解決できないため。
FROM node:26.7.0-bookworm-slim AS builder
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PATH=/pnpm:$PATH

# Node 25 以降 corepack はイメージへ同梱されない
RUN mkdir -p /pnpm && npm install -g corepack@latest && corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/refresh-trigger/package.json ./apps/refresh-trigger/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --filter "@mf-dashboard/refresh-trigger..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/refresh-trigger..."

COPY tsconfig.json ./
COPY apps/refresh-trigger ./apps/refresh-trigger

RUN pnpm --filter @mf-dashboard/refresh-trigger bundle

FROM public.ecr.aws/lambda/nodejs:22

COPY --from=builder /app/apps/refresh-trigger/dist/index.mjs ${LAMBDA_TASK_ROOT}/index.mjs

CMD ["index.handler"]
