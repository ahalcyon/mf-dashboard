# 金融機関の一括更新を開始するだけのジョブ。
#
# クロールと同じ実行に縛られていた頃は、1 口座が更新を終えないだけで
# 取り込みまで最大 20 分待たされていた（#93）。更新の開始と取り込みを
# 別のジョブに分け、取り込み側はその時点の状態を読む。
#
# Fargate ではなく Lambda に置く。待たないので所要時間は 30 秒ほどで、
# 15 分の上限に対して十分な余裕がある。

resource "aws_ecr_repository" "bulk_refresh" {
  name                 = "${var.name_prefix}/bulk-refresh"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "bulk_refresh" {
  repository = aws_ecr_repository.bulk_refresh.name

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

resource "aws_cloudwatch_log_group" "bulk_refresh" {
  name              = "/aws/lambda/${var.name_prefix}-bulk-refresh"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "bulk_refresh" {
  name               = "${var.name_prefix}-bulk-refresh"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "bulk_refresh" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.bulk_refresh.arn}:*"]
  }

  # ECS のタスク定義のような secrets の注入が Lambda には無いため、
  # 認証情報は実行時に自分で読む。crawler のタスクロールと同じ範囲。
  statement {
    sid       = "ReadCredentialsAtRuntime"
    actions   = ["ssm:GetParameters", "ssm:GetParameter"]
    resources = values(local.ssm_parameter_arns)
  }
}

resource "aws_iam_role_policy" "bulk_refresh" {
  name   = "bulk-refresh"
  role   = aws_iam_role.bulk_refresh.id
  policy = data.aws_iam_policy_document.bulk_refresh.json
}

resource "aws_lambda_function" "bulk_refresh" {
  depends_on = [aws_iam_role_policy.bulk_refresh, terraform_data.image["bulk-refresh"]]

  function_name = "${var.name_prefix}-bulk-refresh"
  role          = aws_iam_role.bulk_refresh.arn
  package_type  = "Image"
  image_uri     = local.image_uris["bulk-refresh"]
  timeout       = var.bulk_refresh_timeout_seconds
  memory_size   = var.bulk_refresh_memory

  # Chromium は書き込み先を必要とする。既定の 512 MB では起動に失敗しうる。
  ephemeral_storage {
    size = var.bulk_refresh_ephemeral_storage
  }

  environment {
    variables = {
      TZ                   = "Asia/Tokyo"
      SSM_PARAMETER_PREFIX = local.ssm_parameter_prefix
      # Lambda で書けるのは /tmp だけ。ログイン後の保存先をそこへ向ける。
      # コンテナが温かいうちは次の呼び出しでセッションを再利用でき、
      # Money Forward へのログイン回数を抑えられる。
      AUTH_STATE_PATH = "/tmp/auth-state.json"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.bulk_refresh.name
  }
}

# 同時に 2 つ走ると、同じアカウントで 2 セッションがログインし、
# 片方のセッションが無効化されうる。1 本に固定する。
resource "aws_lambda_function_event_invoke_config" "bulk_refresh" {
  function_name          = aws_lambda_function.bulk_refresh.function_name
  maximum_retry_attempts = 0
}

# --- スケジュール ---------------------------------------------------------

data "aws_iam_policy_document" "bulk_refresh_scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.bulk_refresh.arn]
  }
}

resource "aws_iam_role" "bulk_refresh_scheduler" {
  name               = "${var.name_prefix}-bulk-refresh-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "bulk_refresh_scheduler" {
  name   = "invoke-bulk-refresh"
  role   = aws_iam_role.bulk_refresh_scheduler.id
  policy = data.aws_iam_policy_document.bulk_refresh_scheduler.json
}

resource "aws_scheduler_schedule" "bulk_refresh" {
  name                         = "${var.name_prefix}-bulk-refresh"
  description                  = "Start the Money Forward bulk account refresh"
  schedule_expression          = var.bulk_refresh_schedule_expression
  schedule_expression_timezone = var.schedule_timezone
  state                        = var.enable_bulk_refresh_schedule ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.bulk_refresh.arn
    role_arn = aws_iam_role.bulk_refresh_scheduler.arn

    # 失敗しても再試行しない。次の実行が同じことをするし、再試行は
    # ログインを増やすだけで、更新が始まらなかった回を取り戻せない。
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "bulk_refresh_errors" {
  alarm_name          = "${var.name_prefix}-bulk-refresh-errors"
  alarm_description   = "The bulk account refresh is failing. The dashboard will show values from the last successful refresh."
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
    FunctionName = aws_lambda_function.bulk_refresh.function_name
  }
}
