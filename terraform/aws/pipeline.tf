# データベースが更新されたら静的サイトを焼き直す。
# フロントは読み取り専用なので、実行時の DB 接続を持たせずビルド時に値を焼き込む。

resource "aws_cloudwatch_log_group" "site_build" {
  name              = "/aws/codebuild/${var.name_prefix}-site"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "site_build" {
  name               = "${var.name_prefix}-site-build"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

data "aws_iam_policy_document" "site_build" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.site_build.arn}:*"]
  }

  statement {
    sid       = "ReadDatabase"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/${var.database_object_key}"]
  }

  statement {
    sid       = "PublishSite"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "ListSite"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "InvalidateCache"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "site_build" {
  name   = "site-build"
  role   = aws_iam_role.site_build.id
  policy = data.aws_iam_policy_document.site_build.json
}

resource "aws_codebuild_project" "site" {
  count = var.enable_site_build ? 1 : 0

  name           = "${var.name_prefix}-site"
  description    = "Bake the SQLite database into the static dashboard and publish it"
  service_role   = aws_iam_role.site_build.arn
  build_timeout  = 30
  queued_timeout = 60

  source {
    type            = "GITHUB"
    location        = var.source_repository_url
    git_clone_depth = 1
    buildspec       = ".aws/buildspec-site.yml"
  }

  source_version = var.source_branch

  artifacts {
    type = "NO_ARTIFACTS"
  }

  cache {
    type  = "LOCAL"
    modes = ["LOCAL_CUSTOM_CACHE", "LOCAL_SOURCE_CACHE"]
  }

  environment {
    type                        = "LINUX_CONTAINER"
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "DATA_BUCKET"
      value = aws_s3_bucket.data.id
    }

    environment_variable {
      name  = "DATABASE_OBJECT_KEY"
      value = var.database_object_key
    }

    environment_variable {
      name  = "SITE_BUCKET"
      value = aws_s3_bucket.site.id
    }

    environment_variable {
      name  = "DISTRIBUTION_ID"
      value = aws_cloudfront_distribution.site.id
    }

    environment_variable {
      name  = "DASHBOARD_URL"
      value = var.hostname == "" ? "https://${aws_cloudfront_distribution.site.domain_name}" : "https://${var.hostname}"
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.site_build.name
    }
  }
}

# --- 起動トリガー ---------------------------------------------------------

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "site_build_trigger" {
  count = var.enable_site_build ? 1 : 0

  name               = "${var.name_prefix}-site-build-trigger"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

data "aws_iam_policy_document" "site_build_trigger" {
  count = var.enable_site_build ? 1 : 0

  statement {
    actions   = ["codebuild:StartBuild"]
    resources = [aws_codebuild_project.site[0].arn]
  }
}

resource "aws_iam_role_policy" "site_build_trigger" {
  count = var.enable_site_build ? 1 : 0

  name   = "start-site-build"
  role   = aws_iam_role.site_build_trigger[0].id
  policy = data.aws_iam_policy_document.site_build_trigger[0].json
}

resource "aws_cloudwatch_event_rule" "database_updated" {
  count = var.enable_site_build ? 1 : 0

  name        = "${var.name_prefix}-database-updated"
  description = "Rebuild the static site when the writer publishes a new database"

  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.data.id] }
      object = { key = [var.database_object_key] }
    }
  })
}

resource "aws_cloudwatch_event_target" "site_build" {
  count = var.enable_site_build ? 1 : 0

  rule     = aws_cloudwatch_event_rule.database_updated[0].name
  arn      = aws_codebuild_project.site[0].arn
  role_arn = aws_iam_role.site_build_trigger[0].arn
}
