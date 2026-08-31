# ダッシュボードから当日分のクロールを起動する経路。
#
# CloudFront の /api/* ビヘイビアの後ろに置く。認証は viewer-request 関数が
# ビヘイビア全体で行う。Function URL は OAC で CloudFront からのみ到達する。

resource "aws_ecr_repository" "refresh_trigger" {
  name                 = "${var.name_prefix}/refresh-trigger"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "refresh_trigger" {
  repository = aws_ecr_repository.refresh_trigger.name

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

resource "aws_cloudwatch_log_group" "refresh_trigger" {
  name              = "/aws/lambda/${var.name_prefix}-refresh-trigger"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "refresh_trigger" {
  name               = "${var.name_prefix}-refresh-trigger"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "refresh_trigger" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.refresh_trigger.arn}:*"]
  }

  statement {
    sid     = "StartRefreshAndCrawl"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.bulk_refresh.arn,
      aws_lambda_function.crawl.arn,
    ]
  }
}

resource "aws_iam_role_policy" "refresh_trigger" {
  name   = "refresh-trigger"
  role   = aws_iam_role.refresh_trigger.id
  policy = data.aws_iam_policy_document.refresh_trigger.json
}

resource "aws_lambda_function" "refresh_trigger" {
  depends_on = [aws_iam_role_policy.refresh_trigger, terraform_data.image["refresh-trigger"]]

  function_name = "${var.name_prefix}-refresh-trigger"
  role          = aws_iam_role.refresh_trigger.arn
  package_type  = "Image"
  image_uri     = local.image_uris["refresh-trigger"]
  timeout       = 30
  memory_size   = 512

  environment {
    variables = {
      TZ                    = "Asia/Tokyo"
      BULK_REFRESH_FUNCTION = aws_lambda_function.bulk_refresh.function_name
      CRAWL_FUNCTION        = aws_lambda_function.crawl.function_name
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.refresh_trigger.name
  }
}

resource "aws_lambda_function_url" "refresh_trigger" {
  function_name      = aws_lambda_function.refresh_trigger.function_name
  authorization_type = "AWS_IAM"
}

# OAC は InvokeFunctionUrl と InvokeFunction の両方を必要とする。
resource "aws_lambda_permission" "refresh_trigger_url_from_cloudfront" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.refresh_trigger.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

# function_url_auth_type は InvokeFunctionUrl にしか指定できない
resource "aws_lambda_permission" "refresh_trigger_from_cloudfront" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refresh_trigger.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudfront_origin_access_control" "refresh_trigger" {
  name                              = "${var.name_prefix}-refresh-trigger"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudwatch_metric_alarm" "refresh_trigger_errors" {
  alarm_name          = "${var.name_prefix}-refresh-trigger-errors"
  alarm_description   = "The manual refresh trigger is failing. The dashboard button no longer starts a crawl."
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
    FunctionName = aws_lambda_function.refresh_trigger.function_name
  }
}
