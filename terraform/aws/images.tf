# コンテナイメージのビルドと push を apply の一部にする。
#
# 手元でビルドして push してから apply する運用だと、Terraform が
# 「No changes.」でも中身が古いままになる。実際にそれを踏んだ。
# タグをソースのハッシュにすることで、内容が変わったときだけビルドが走り、
# タスク定義と Lambda の参照も同時に切り替わる。

locals {
  project_root = "${path.root}/../.."

  # イメージに焼き込まれる範囲。ここに挙げたパス配下が変わるとタグが変わる。
  image_sources = {
    crawler = [
      "docker/crawler",
      "apps/crawler/package.json",
      "apps/crawler/src",
      "apps/crawler/tsconfig.json",
      "packages/db",
      "packages/date-utils",
      "packages/meta",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
    ]
    writer = [
      "docker/writer",
      "apps/writer",
      "packages/db",
      "packages/date-utils",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
    ]
    bulk-refresh = [
      "docker/bulk-refresh",
      "apps/bulk-refresh",
      "apps/crawler/package.json",
      "apps/crawler/src",
      "apps/crawler/tsconfig.json",
      "packages/db",
      "packages/date-utils",
      "packages/meta",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
    ]
    refresh-trigger = [
      "docker/refresh-trigger",
      "apps/refresh-trigger",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
    ]
    "site-builder" = [
      "docker/site-builder",
      "scripts/publish-site.mjs",
      "apps/web/package.json",
      "apps/web/src",
      "apps/web/scripts",
      "apps/web/next.config.ts",
      "apps/web/tsconfig.json",
      "apps/web/postcss.config.mjs",
      "packages/db",
      "packages/analytics",
      "packages/date-utils",
      "packages/meta",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
    ]
  }

  ecr_repositories = {
    bulk-refresh    = aws_ecr_repository.bulk_refresh.repository_url
    crawler         = aws_ecr_repository.crawler.repository_url
    writer          = aws_ecr_repository.writer.repository_url
    refresh-trigger = aws_ecr_repository.refresh_trigger.repository_url
    "site-builder"  = aws_ecr_repository.site_builder.repository_url
  }
}

data "external" "image_source" {
  for_each = local.image_sources

  program = ["node", "${local.project_root}/scripts/image-source-hash.mjs"]
  query = {
    paths = join(",", each.value)
  }
}

locals {
  image_tags = { for name, source in data.external.image_source : name => source.result.hash }
  image_uris = { for name, url in local.ecr_repositories : name => "${url}:${local.image_tags[name]}" }
}

resource "terraform_data" "image" {
  for_each = local.ecr_repositories

  # ハッシュが変わったときだけ作り直す = ビルドが走る
  triggers_replace = local.image_tags[each.key]

  provisioner "local-exec" {
    working_dir = local.project_root
    command = join(" ", [
      "node scripts/publish-image.mjs",
      "--dockerfile docker/${each.key}/Dockerfile",
      "--repository ${each.value}",
      "--tag ${local.image_tags[each.key]}",
      "--region ${var.region}",
      "--cli '${var.container_cli}'",
    ])
  }
}
