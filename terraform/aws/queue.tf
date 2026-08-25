# S3 上の SQLite はファイル全体を書き換えるしかないため、書き込みは
# 厳密に直列化する必要がある。それを担保しているのは FIFO キューと
# 単一 MessageGroupId の 2 点で、writer の予約同時実行数はその上に重ねる
# 多重防御（既定は無効。#10 を参照）。
# 送信側は必ず MessageGroupId = local.write_message_group_id を使うこと。
# この値は packages/db の SYNC_MESSAGE_GROUP_ID と一致していなければならず、
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

  # 宛先が無いと発報しても誰にも届かない。DLQ に落ちた分はそのクロールが
  # 失われているので、気づけないと古い数字を見続けることになる。
  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  dimensions = {
    QueueName = aws_sqs_queue.writes_dlq.name
  }
}
