# 金融機関の一括更新を開始する。更新の完了は待たず、30 秒ほどで終わる。

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

  ephemeral_storage {
    size = var.bulk_refresh_ephemeral_storage
  }

  environment {
    variables = {
      TZ                   = "Asia/Tokyo"
      SSM_PARAMETER_PREFIX = local.ssm_parameter_prefix
      AUTH_STATE_PATH      = "/tmp/auth-state.json"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.bulk_refresh.name
  }
}

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
