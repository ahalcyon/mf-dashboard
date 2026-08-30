data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name_prefix}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- 認証情報 -------------------------------------------------------------
# 資格情報は KeyValueStore に置き、エッジの関数から読む。

resource "random_password" "basic_auth" {
  length  = 32
  special = false
}

resource "random_password" "session" {
  length  = 48
  special = false
}

locals {
  basic_auth_password = var.basic_auth_password != "" ? var.basic_auth_password : random_password.basic_auth.result
  basic_auth_header   = "Basic ${base64encode("${var.basic_auth_username}:${local.basic_auth_password}")}"
}

resource "aws_cloudfront_key_value_store" "auth" {
  name    = "${var.name_prefix}-auth"
  comment = "Credentials checked by the viewer-request function"
}

resource "aws_cloudfrontkeyvaluestore_key" "authorization" {
  key_value_store_arn = aws_cloudfront_key_value_store.auth.arn
  key                 = "authorization"
  value               = local.basic_auth_header
}

resource "aws_cloudfrontkeyvaluestore_key" "session" {
  key_value_store_arn = aws_cloudfront_key_value_store.auth.arn
  key                 = "session"
  value               = random_password.session.result
}

# --- viewer-request -------------------------------------------------------
# 認証とディレクトリインデックスの書き換えを 1 つの関数で行う。
# 初回だけ Basic 認証を検証し、以後はクッキーで通す。
resource "aws_cloudfront_function" "viewer_request" {
  name    = "${var.name_prefix}-viewer-request"
  runtime = "cloudfront-js-2.0"
  comment = "Basic auth upgraded to a session cookie, then directory index rewriting"
  publish = true

  key_value_store_associations = [aws_cloudfront_key_value_store.auth.arn]

  code = templatefile("${path.module}/functions/viewer-request.js", {
    session_cookie_max_age_seconds = var.session_cookie_max_age_seconds
  })
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name_prefix
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  aliases             = var.hostname == "" ? [] : [var.hostname]

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id                = "refresh-trigger"
    domain_name              = replace(replace(aws_lambda_function_url.refresh_trigger.function_url, "https://", ""), "/", "")
    origin_access_control_id = aws_cloudfront_origin_access_control.refresh_trigger.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  # 認証は default_cache_behavior と同じ viewer-request 関数が担う。
  # Authorization ヘッダーは OAC の SigV4 署名に使う。
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "refresh-trigger"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.hostname == ""
    acm_certificate_arn            = var.hostname == "" ? null : var.acm_certificate_arn
    ssl_support_method             = var.hostname == "" ? null : "sni-only"
    minimum_protocol_version       = var.hostname == "" ? null : "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}
