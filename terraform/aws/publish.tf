# データベースが更新されたら静的サイトを焼き直す。
# フロントは実行時の DB 接続を持たず、ビルド時に値を焼き込む。
#
# ビルドは GitHub Actions で回す。CodeBuild を使うと GitHub 接続の認可が
# Terraform の管理外で必要になり、リポジトリと CI の二重管理になるため。

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "site_publisher_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # 対象のリポジトリからのワークフローだけに絞る
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.source_repository}:*"]
    }
  }
}

resource "aws_iam_role" "site_publisher" {
  name               = "${var.name_prefix}-site-publisher"
  description        = "Assumed by GitHub Actions to build and publish the static dashboard"
  assume_role_policy = data.aws_iam_policy_document.site_publisher_assume.json
}

data "aws_iam_policy_document" "site_publisher" {
  statement {
    sid       = "ReadDatabase"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/${var.database_object_key}"]
  }

  statement {
    sid       = "PublishSite"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "ListSite"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "InvalidateCache"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "site_publisher" {
  name   = "site-publisher"
  role   = aws_iam_role.site_publisher.id
  policy = data.aws_iam_policy_document.site_publisher.json
}
