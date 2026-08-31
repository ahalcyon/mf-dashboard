resource "aws_ecr_repository" "writer" {
  name                 = "${var.name_prefix}/writer"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "writer" {
  repository = aws_ecr_repository.writer.name

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

data "aws_cloudwatch_event_bus" "default" {
  name = "default"
}

resource "aws_cloudwatch_log_group" "writer" {
  name              = "/aws/lambda/${var.name_prefix}-writer"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "writer" {
  name               = "${var.name_prefix}-writer"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "writer" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.writer.arn}:*"]
  }

  statement {
    sid       = "ConsumeDatabaseWrites"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.writes.arn]
  }

  statement {
    sid       = "ReadWriteDatabaseObject"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/${var.database_object_key}"]
  }

  statement {
    sid       = "ReadCrawlPayloads"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/payloads/*"]
  }

  statement {
    sid       = "AnnounceCrawlCompletion"
    actions   = ["events:PutEvents"]
    resources = [data.aws_cloudwatch_event_bus.default.arn]
  }

  statement {
    sid       = "DiscoverDatabaseObject"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.data.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [var.database_object_key]
    }
  }
}

resource "aws_iam_role_policy" "writer" {
  name   = "writer"
  role   = aws_iam_role.writer.id
  policy = data.aws_iam_policy_document.writer.json
}

# SQLite をまるごと書き換える単一ライタ。書き込みは FIFO キューと
# 単一 MessageGroupId、および予約同時実行数 1 で直列化される。
resource "aws_lambda_function" "writer" {
  function_name = "${var.name_prefix}-writer"
  role          = aws_iam_role.writer.arn
  package_type  = "Image"
  image_uri     = local.image_uris.writer
  timeout       = var.writer_timeout_seconds
  memory_size   = var.writer_memory

  reserved_concurrent_executions = var.writer_reserved_concurrency

  ephemeral_storage {
    size = 4096
  }

  environment {
    variables = {
      TZ                  = "Asia/Tokyo"
      DATA_BUCKET         = aws_s3_bucket.data.id
      DATABASE_OBJECT_KEY = var.database_object_key
      # site-builder を起動するルールと一致させる。既定値は持たない。
      EVENT_BUS_NAME              = data.aws_cloudwatch_event_bus.default.name
      CRAWL_COMPLETED_SOURCE      = local.crawl_completed_event.source
      CRAWL_COMPLETED_DETAIL_TYPE = local.crawl_completed_event.detail_type
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.writer.name
  }

  depends_on = [aws_iam_role_policy.writer, terraform_data.image["writer"]]
}

resource "aws_lambda_event_source_mapping" "writes" {
  event_source_arn = aws_sqs_queue.writes.arn
  function_name    = aws_lambda_function.writer.arn

  # 上限。ポーラーはバッチが埋まるのを待たない。
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_metric_alarm" "writer_errors" {
  alarm_name          = "${var.name_prefix}-writer-errors"
  alarm_description   = "The SQLite writer Lambda is failing."
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
    FunctionName = aws_lambda_function.writer.function_name
  }
}
