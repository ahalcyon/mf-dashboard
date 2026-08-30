locals {
  ssm_parameter_prefix = trimsuffix(var.ssm_parameter_prefix, "/")

  ssm_parameter_arns = {
    email       = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_parameter_prefix}/email"
    password    = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_parameter_prefix}/password"
    totp_secret = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_parameter_prefix}/totp-secret"
  }

}

resource "aws_ecr_repository" "crawler" {
  name                 = "${var.name_prefix}/crawler"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "crawler" {
  repository = aws_ecr_repository.crawler.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the deployed image and the one before it"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 2
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "crawler" {
  name              = "/aws/ecs/${var.name_prefix}-crawler"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

# --- IAM -----------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "crawler_execution" {
  name               = "${var.name_prefix}-crawler-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "crawler_execution_managed" {
  role       = aws_iam_role.crawler_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# 実行ロールは、コンテナ起動時に secrets を解決するために SSM を読む。
data "aws_iam_policy_document" "crawler_execution_secrets" {
  statement {
    actions   = ["ssm:GetParameters"]
    resources = values(local.ssm_parameter_arns)
  }
}

resource "aws_iam_role_policy" "crawler_execution_secrets" {
  name   = "read-moneyforward-credentials"
  role   = aws_iam_role.crawler_execution.id
  policy = data.aws_iam_policy_document.crawler_execution_secrets.json
}

resource "aws_iam_role" "crawler_task" {
  name               = "${var.name_prefix}-crawler-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# タスクロールは書き込みキューへの送信のみ。データベースへは直接触らせない。
data "aws_iam_policy_document" "crawler_task" {
  statement {
    sid       = "PublishDatabaseWrites"
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.writes.arn]
  }

  statement {
    sid = "ReadWorkingDatabaseCopy"
    # crawler は authoritative なデータベースを持たない。読み取り用の複製を
    # 落として作業し、書き込みはすべて payload として発行する。
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/${var.database_object_key}"]
  }

  statement {
    sid = "PublishCrawlPayloads"
    # SQS の 256 KiB 上限を超えるため、実データは S3 に置きメッセージには位置だけを載せる
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/payloads/*"]
  }

  statement {
    sid       = "PublishNotifications"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.notifications.arn]
  }

  statement {
    sid       = "ReadCredentialsAtRuntime"
    actions   = ["ssm:GetParameters", "ssm:GetParameter"]
    resources = values(local.ssm_parameter_arns)
  }
}

resource "aws_iam_role_policy" "crawler_task" {
  name   = "crawler-task"
  role   = aws_iam_role.crawler_task.id
  policy = data.aws_iam_policy_document.crawler_task.json
}

# --- バックフィル用タスク定義 ---------------------------------------------
#
# 定期クロールは Lambda に移った（crawl.tf）。ここに残るのは history モード
# だけで、起動は手動に限る。前年 1 月からの取得は 20 か月ぶんになり、
# Lambda の 15 分に収まる保証が無い。
#
# イメージは Lambda と同じものを使い、entryPoint だけ CLI に上書きする。
# 分けると、バックフィルと定期クロールが違う Chromium で描画しうる。

resource "aws_ecs_task_definition" "crawler" {
  # イメージが push されてからタスク定義を更新する
  depends_on = [terraform_data.image["crawler"]]

  family                   = "${var.name_prefix}-crawler"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.crawler_cpu
  memory                   = var.crawler_memory
  execution_role_arn       = aws_iam_role.crawler_execution.arn
  task_role_arn            = aws_iam_role.crawler_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "crawler"
    image     = local.image_uris.crawler
    essential = true

    # イメージの既定は Lambda の Runtime Interface Client。ECS では CLI として
    # 動かすので上書きする。command を空にしないと、イメージの CMD
    # （ハンドラ名）が引数として後ろに付く。
    entryPoint = ["/usr/bin/tini", "--", "node", "--import", "tsx", "src/index.ts"]
    command    = []

    environment = [
      { name = "TZ", value = "Asia/Tokyo" },
      { name = "CRAWLER_RUN_SOURCE", value = "backfill" },
      # このタスクの存在理由。実行時の判定に任せると、S3 のデータベースが
      # 取れたときに月モードで走ってしまい、バックフィルにならない。
      { name = "SCRAPE_MODE", value = "history" },
      # 一括更新の開始は bulk-refresh Lambda が受け持つ。待っていた頃は
      # 1 口座が終わらないだけで最大 20 分ここで止まっていた（#93）。
      { name = "SKIP_REFRESH", value = "true" },
      { name = "CRAWLER_STATE_PATH", value = "/tmp/crawler-run-state.json" },
      { name = "AUTH_STATE_PATH", value = "/tmp/auth-state.json" },
      { name = "SSM_PARAMETER_PREFIX", value = local.ssm_parameter_prefix },
      { name = "WRITE_QUEUE_URL", value = aws_sqs_queue.writes.url },
      { name = "WRITE_MESSAGE_GROUP_ID", value = local.write_message_group_id },
      { name = "DATA_BUCKET", value = aws_s3_bucket.data.id },
      { name = "DATABASE_OBJECT_KEY", value = var.database_object_key },
      { name = "DB_PATH", value = "/tmp/moneyforward.db" },
      { name = "AWS_REGION", value = var.region },
      { name = "NOTIFICATION_TOPIC_ARN", value = aws_sns_topic.notifications.arn },
    ]

    secrets = [
      { name = "MF_EMAIL", valueFrom = local.ssm_parameter_arns.email },
      { name = "MF_PASSWORD", valueFrom = local.ssm_parameter_arns.password },
      { name = "MF_TOTP_SECRET", valueFrom = local.ssm_parameter_arns.totp_secret },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.crawler.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "crawler"
      }
    }
  }])
}

# --- スケジューラの assume role ---------------------------------------------
# crawl.tf と bulk-refresh.tf の両方が使う。

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}
