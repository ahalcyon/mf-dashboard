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
    sid     = "ConsumeDatabaseWrites"
    actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    # 予約同時実行数 1 と併せて、書き込みを直列化する経路はこの一本だけに保つ。
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

# SQLite をまるごと書き換える単一ライタ。
#
# 書き込みが直列化されるのは、FIFO キューと単一 MessageGroupId により
# SQS が同じグループを一度に 1 バッチしか配信しないため。これが一次保証で、
# 送信側が MessageGroupId を分けた時点で read-modify-write が競合し、
# 後勝ちでデータが消える。
# reserved_concurrent_executions はその二重化だが、アカウントの
# 同時実行クォータが 10 以下だと設定できない（変数の説明を参照）。
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

  # ファイル全体の書き換えは高コストなので、まとめて 1 回で適用する。
  # FIFO キューはバッチングウィンドウを受け付けないため batch_size だけで制御する。
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

  dimensions = {
    FunctionName = aws_lambda_function.writer.function_name
  }
}
