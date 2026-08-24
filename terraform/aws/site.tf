data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
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

# next.config.ts が trailingSlash: true なので、静的エクスポートは
# out/cf/index.html のようなディレクトリ構造を吐く。S3 オリジンは
# ディレクトリインデックスを解決しないため、ここで明示的に書き換える。
resource "aws_cloudfront_function" "rewrite_index" {
  name    = "${var.name_prefix}-rewrite-index"
  runtime = "cloudfront-js-2.0"
  comment = "Map directory-style paths to their index.html"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      if (uri.endsWith("/")) {
        request.uri = uri + "index.html";
      } else if (!uri.split("/").pop().includes(".")) {
        request.uri = uri + "/index.html";
      }

      return request;
    }
  JS
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
      function_arn = aws_cloudfront_function.rewrite_index.arn
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
