# データベースが更新されたら静的サイトを焼き直す。
#
# フロントは実行時の DB 接続を持たないため、データを反映するにはビルドし直す。
# CodeBuild を使うと GitHub 接続の認可が Terraform の管理外で必要になるので、
# crawler や writer と同じく「手元でイメージを push して apply」する形に揃える。

resource "aws_ecr_repository" "site_builder" {
  name                 = "${var.name_prefix}/site-builder"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "site_builder" {
  repository = aws_ecr_repository.site_builder.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "site_builder" {
  name              = "/aws/ecs/${var.name_prefix}-site-builder"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "site_builder_execution" {
  name               = "${var.name_prefix}-site-builder-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "site_builder_execution_managed" {
  role       = aws_iam_role.site_builder_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "site_builder_task" {
  name               = "${var.name_prefix}-site-builder-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "site_builder_task" {
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

resource "aws_iam_role_policy" "site_builder_task" {
  name   = "site-builder-task"
  role   = aws_iam_role.site_builder_task.id
  policy = data.aws_iam_policy_document.site_builder_task.json
}

resource "aws_ecs_task_definition" "site_builder" {
  depends_on = [terraform_data.image["site-builder"]]

  family                   = "${var.name_prefix}-site-builder"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.site_builder_cpu
  memory                   = var.site_builder_memory
  execution_role_arn       = aws_iam_role.site_builder_execution.arn
  task_role_arn            = aws_iam_role.site_builder_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "site-builder"
    image     = local.image_uris["site-builder"]
    essential = true

    environment = [
      { name = "TZ", value = "Asia/Tokyo" },
      { name = "AWS_REGION", value = var.region },
      { name = "AWS_DEFAULT_REGION", value = var.region },
      { name = "DATA_BUCKET", value = aws_s3_bucket.data.id },
      { name = "SITE_BUCKET", value = aws_s3_bucket.site.id },
      { name = "CLOUDFRONT_DISTRIBUTION_ID", value = aws_cloudfront_distribution.site.id },
      {
        name  = "SITE_URL"
        value = var.hostname == "" ? "https://${aws_cloudfront_distribution.site.domain_name}" : "https://${var.hostname}"
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.site_builder.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "site-builder"
      }
    }
  }])
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

resource "aws_iam_role" "site_builder_trigger" {
  name               = "${var.name_prefix}-site-builder-trigger"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

data "aws_iam_policy_document" "site_builder_trigger" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.site_builder.arn_without_revision}:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.this.arn]
    }
  }

  statement {
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.site_builder_execution.arn,
      aws_iam_role.site_builder_task.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "site_builder_trigger" {
  name   = "run-site-builder"
  role   = aws_iam_role.site_builder_trigger.id
  policy = data.aws_iam_policy_document.site_builder_trigger.json
}

# 再ビルドの起点。
#
# 以前は S3 の Object Created で、writer が書き戻すたびに発火していた。
# 履歴を月ごとに送るようになってから 1 回のクロールで 3 本、バックフィルなら
# 21 本の site-builder が走っていた。writer が「この run の分は適用し終えた」と
# 知らせるイベントに変え、クロール 1 回につき 1 回にした。
#
# 名前は writer にも環境変数で渡している。ここだけ変えると再ビルドが黙って止まる。
locals {
  crawl_completed_event = {
    source      = "mf-dashboard.writer"
    detail_type = "Crawl Completed"
  }
}

resource "aws_cloudwatch_event_rule" "crawl_completed" {
  name        = "${var.name_prefix}-crawl-completed"
  description = "Rebuild the static site once the writer has applied everything a crawl produced"

  event_pattern = jsonencode({
    source        = [local.crawl_completed_event.source]
    "detail-type" = [local.crawl_completed_event.detail_type]
  })
}

resource "aws_cloudwatch_event_target" "site_builder" {
  rule     = aws_cloudwatch_event_rule.crawl_completed.name
  arn      = aws_ecs_cluster.this.arn
  role_arn = aws_iam_role.site_builder_trigger.arn

  ecs_target {
    task_definition_arn = aws_ecs_task_definition.site_builder.arn_without_revision
    launch_type         = "FARGATE"
    task_count          = 1

    network_configuration {
      subnets          = [for subnet in aws_subnet.public : subnet.id]
      security_groups  = [aws_security_group.crawler.id]
      assign_public_ip = true
    }
  }
}
