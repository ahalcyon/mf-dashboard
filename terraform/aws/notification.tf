# クロール結果と、構成の異常をメールで届ける。
#
# crawler はタスクの中から総資産・前日比・今月比を送る。

resource "aws_sns_topic" "notifications" {
  name         = "${var.name_prefix}-notifications"
  display_name = "mf-dashboard"
}

# 宛先は SSM に置く。
data "aws_ssm_parameter" "notification_email" {
  count = var.notification_email_parameter == "" ? 0 : 1

  name            = var.notification_email_parameter
  with_decryption = true
}

locals {
  notification_email = one(data.aws_ssm_parameter.notification_email[*].value)
}

# subscription は確認メールを承認するまで PendingConfirmation のまま残る。
resource "aws_sns_topic_subscription" "email" {
  count = local.notification_email == null ? 0 : 1

  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = local.notification_email
}

# --- 障害の通知 -----------------------------------------------------------
# アラームと EventBridge から同じトピックへ流す。

data "aws_iam_policy_document" "notifications" {
  statement {
    sid       = "AllowServicePublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.notifications.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "notifications" {
  arn    = aws_sns_topic.notifications.arn
  policy = data.aws_iam_policy_document.notifications.json
}

# タスクの終了コードで失敗を拾う。
#
resource "aws_cloudwatch_event_rule" "task_failed" {
  name        = "${var.name_prefix}-task-failed"
  description = "An ECS task in this cluster exited non-zero"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.this.arn]
      lastStatus = ["STOPPED"]
      containers = {
        exitCode = [{ "anything-but" = [0] }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "task_failed" {
  rule      = aws_cloudwatch_event_rule.task_failed.name
  arn       = aws_sns_topic.notifications.arn
  target_id = "notify"

  input_transformer {
    input_paths = {
      group  = "$.detail.group"
      reason = "$.detail.stoppedReason"
      task   = "$.detail.taskArn"
    }
    # 本文は一行にまとめる
    input_template = "\"mf-dashboard: an ECS task failed. group=<group> reason=<reason> task=<task>\""
  }
}
