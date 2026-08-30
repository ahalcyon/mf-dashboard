data "aws_caller_identity" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  data_bucket = "${var.name_prefix}-data-${local.account_id}"
  site_bucket = "${var.name_prefix}-site-${local.account_id}"
}

# --- SQLite データベース -------------------------------------------------
# S3 には部分書き込みもロックも無いため、書き込みはファイル全体の
# read-modify-write になる。バージョニングは事故時の唯一の巻き戻し手段なので必須。

resource "aws_s3_bucket" "data" {
  bucket = local.data_bucket
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket     = aws_s3_bucket.data.id
  depends_on = [aws_s3_bucket_versioning.data]

  # ペイロードは writer が適用した時点で用済み。失敗調査の猶予だけ残して消す。
  rule {
    id     = "expire-applied-payloads"
    status = "Enabled"

    filter {
      prefix = "payloads/"
    }

    expiration {
      days = var.payload_retention_days
    }
  }

  rule {
    id     = "expire-noncurrent-database-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# --- 静的サイト ----------------------------------------------------------

resource "aws_s3_bucket" "site" {
  bucket = local.site_bucket
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}
