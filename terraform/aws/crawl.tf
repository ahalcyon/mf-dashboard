# 定期クロール。その時点の口座状態を取り込む。実測 80 秒。
# イメージは ECS のバックフィルタスクと共有する。

resource "aws_cloudwatch_log_group" "crawl" {
  name              = "/aws/lambda/${var.name_prefix}-crawl"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "crawl" {
  name               = "${var.name_prefix}-crawl"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# crawler は S3 のデータベースの複製を読み、書き込みは payload として発行する。
data "aws_iam_policy_document" "crawl" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.crawl.arn}:*"]
  }

  statement {
    sid       = "PublishDatabaseWrites"
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.writes.arn]
  }

  statement {
    sid       = "ReadWorkingDatabaseCopy"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/${var.database_object_key}"]
  }

  statement {
    sid = "PublishCrawlPayloads"
    # 実データは S3 に置き、メッセージには位置だけを載せる
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/payloads/*"]
  }

  statement {
    sid       = "PublishNotifications"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.notifications.arn]
  }

  # 認証情報は実行時に SSM から読む。
  statement {
    sid       = "ReadCredentialsAtRuntime"
    actions   = ["ssm:GetParameters", "ssm:GetParameter"]
    resources = values(local.ssm_parameter_arns)
  }
}

resource "aws_iam_role_policy" "crawl" {
  name   = "crawl"
  role   = aws_iam_role.crawl.id
  policy = data.aws_iam_policy_document.crawl.json
}

resource "aws_lambda_function" "crawl" {
  depends_on = [aws_iam_role_policy.crawl, terraform_data.image["crawler"]]

  function_name = "${var.name_prefix}-crawl"
  role          = aws_iam_role.crawl.arn
  package_type  = "Image"
  image_uri     = local.image_uris.crawler
  timeout       = var.crawl_timeout_seconds
  memory_size   = var.crawl_memory

  # 同時実行を 1 に制限する。-1 で予約しない。
  reserved_concurrent_executions = var.crawl_reserved_concurrency

  image_config {
    # Lambda のハンドラ。
    command = ["apps/crawler/src/lambda.handler"]
  }

  # Chromium のプロファイルと作業用データベースの置き場。
  ephemeral_storage {
    size = var.crawl_ephemeral_storage
  }

  environment {
    variables = {
      TZ                 = "Asia/Tokyo"
      CRAWLER_RUN_SOURCE = "scheduled"
      SKIP_REFRESH       = "true"
      # 月モードに固定する。バックフィルは ECS のタスクが受け持つ。
      SCRAPE_MODE            = "month"
      SSM_PARAMETER_PREFIX   = local.ssm_parameter_prefix
      WRITE_QUEUE_URL        = aws_sqs_queue.writes.url
      WRITE_MESSAGE_GROUP_ID = local.write_message_group_id
      DATA_BUCKET            = aws_s3_bucket.data.id
      DATABASE_OBJECT_KEY    = var.database_object_key
      NOTIFICATION_TOPIC_ARN = aws_sns_topic.notifications.arn
      # 書き込み先は /tmp
      DB_PATH            = "/tmp/moneyforward.db"
      CRAWLER_STATE_PATH = "/tmp/crawler-run-state.json"
      AUTH_STATE_PATH    = "/tmp/auth-state.json"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.crawl.name
  }
}

# 実行は重ならない。
resource "aws_lambda_function_event_invoke_config" "crawl" {
  function_name          = aws_lambda_function.crawl.function_name
  maximum_retry_attempts = 0
}

# --- スケジュール ---------------------------------------------------------

data "aws_iam_policy_document" "crawl_scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.crawl.arn]
  }
}

resource "aws_iam_role" "crawl_scheduler" {
  name               = "${var.name_prefix}-crawl-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "crawl_scheduler" {
  name   = "invoke-crawl"
  role   = aws_iam_role.crawl_scheduler.id
  policy = data.aws_iam_policy_document.crawl_scheduler.json
}

resource "aws_scheduler_schedule" "crawl" {
  name                         = "${var.name_prefix}-crawl"
  description                  = "Scheduled Money Forward crawl"
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone
  state                        = var.enable_crawler_schedule ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.crawl.arn
    role_arn = aws_iam_role.crawl_scheduler.arn

    # 失敗しても再試行しない。
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "crawl_errors" {
  alarm_name          = "${var.name_prefix}-crawl-errors"
  alarm_description   = "The scheduled crawl is failing. The dashboard is not being updated."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  dimensions = {
    FunctionName = aws_lambda_function.crawl.function_name
  }
}
