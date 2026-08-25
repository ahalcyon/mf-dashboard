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

# --- タスク定義 -----------------------------------------------------------
# Dockerfile の ENTRYPOINT は server + supercronic の常駐用なので、
# スケジュール実行では一回きりの src/index.ts に差し替える。

resource "aws_ecs_task_definition" "crawler" {
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
    name             = "crawler"
    image            = "${aws_ecr_repository.crawler.repository_url}:${var.crawler_image_tag}"
    essential        = true
    entryPoint       = ["/usr/bin/tini", "--"]
    command          = ["node", "--import", "tsx", "src/index.ts"]
    workingDirectory = "/app/apps/crawler"

    environment = [
      { name = "TZ", value = "Asia/Tokyo" },
      { name = "CRAWLER_RUN_SOURCE", value = "scheduled" },
      { name = "SSM_PARAMETER_PREFIX", value = local.ssm_parameter_prefix },
      { name = "WRITE_QUEUE_URL", value = aws_sqs_queue.writes.url },
      { name = "WRITE_MESSAGE_GROUP_ID", value = local.write_message_group_id },
      { name = "DATA_BUCKET", value = aws_s3_bucket.data.id },
      { name = "DATABASE_OBJECT_KEY", value = var.database_object_key },
      { name = "DB_PATH", value = "/tmp/moneyforward.db" },
      { name = "AWS_REGION", value = var.region },
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

# --- スケジュール ---------------------------------------------------------

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

resource "aws_iam_role" "scheduler" {
  name               = "${var.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.crawler.arn_without_revision}:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.this.arn]
    }
  }

  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.crawler_execution.arn, aws_iam_role.crawler_task.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "run-crawler-task"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "crawler" {
  name                         = "${var.name_prefix}-crawler"
  description                  = "Scheduled Money Forward crawl"
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone
  state                        = var.enable_crawler_schedule ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.this.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.crawler.arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        subnets          = [for subnet in aws_subnet.public : subnet.id]
        security_groups  = [aws_security_group.crawler.id]
        assign_public_ip = true
      }
    }

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}
