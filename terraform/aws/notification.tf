# クロール結果をメールで届ける。
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
