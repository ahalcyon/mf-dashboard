# クロール結果と、構成の異常をメールで届ける。
#
# crawler は Money Forward から総資産・前日比・今月比をそのまま取得している
# ため、S3 のデータベース更新を待たずにタスクの中から送れる。writer や
# site-builder の完了を待つ必要はない。

resource "aws_sns_topic" "notifications" {
  name         = "${var.name_prefix}-notifications"
  display_name = "mf-dashboard"
}

# メールの subscription は AWS からの確認メールを承認するまで
# PendingConfirmation のまま残る。承認は利用者が手で行う。
resource "aws_sns_topic_subscription" "email" {
  count = var.notification_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# --- 障害の通知 -----------------------------------------------------------
# アラームと EventBridge から同じトピックへ流す。単一利用者なので、
# 購読先を分ける利点より確認するサブスクリプションが 1 つで済む利点を取る。

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

# crawler は自分で失敗を通知するが、そこへ到達せずに死ぬ場合がある（OOM など）。
# site-builder には通知の口が無い。どちらもタスクの終了コードで拾う。
#
# 起動そのものに失敗した場合は終了コードが存在しないため、この規則では拾えない。
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
    # SNS のメールは本文をそのまま出すので、生の JSON ではなく一行にまとめる
    input_template = "\"mf-dashboard: an ECS task failed. group=<group> reason=<reason> task=<task>\""
  }
}
