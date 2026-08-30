# S3 上の SQLite への書き込みを直列化する FIFO キュー。
# 送信側は必ず MessageGroupId = local.write_message_group_id を使う。
# この値は packages/db の SYNC_MESSAGE_GROUP_ID と一致させる。
# message.test.ts がこのファイルを読んで突き合わせている。

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

  # Lambda の実行時間を上回る値にする。
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

  # DLQ に落ちた分はそのクロールが失われている。
  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  dimensions = {
    QueueName = aws_sqs_queue.writes_dlq.name
  }
}
