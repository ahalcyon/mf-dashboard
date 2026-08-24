# S3 上の SQLite はファイル全体を書き換えるしかないため、書き込みは
# 厳密に直列化する必要がある。FIFO キュー + 単一 MessageGroupId +
# 予約同時実行数 1 の Lambda で、同時に走る書き込みを構造的に排除する。
# 送信側は必ず MessageGroupId = local.write_message_group_id を使うこと。

locals {
  write_message_group_id = "sqlite-write"
}

resource "aws_sqs_queue" "writes_dlq" {
  name                        = "${var.name_prefix}-writes-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  message_retention_seconds   = 1209600 # 14 days
  sqs_managed_sse_enabled     = true
}

resource "aws_sqs_queue" "writes" {
  name                        = "${var.name_prefix}-writes.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  message_retention_seconds   = 345600 # 4 days
  sqs_managed_sse_enabled     = true

  # Lambda の実行時間を下回ると、処理中のメッセージが再配信され二重書き込みになる。
  visibility_timeout_seconds = var.writer_timeout_seconds * 6

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.writes_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "writes_dlq" {
  queue_url = aws_sqs_queue.writes_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.writes.arn]
  })
}

resource "aws_cloudwatch_metric_alarm" "writes_dlq_not_empty" {
  alarm_name          = "${var.name_prefix}-writes-dlq-not-empty"
  alarm_description   = "A database write was retried three times and gave up. The SQLite file is behind the crawl."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.writes_dlq.name
  }
}
