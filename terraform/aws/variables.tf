variable "region" {
  description = "Primary region hosting the crawler, queue, database bucket, and writer"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "Named AWS profile used to provision this deployment"
  type        = string
  default     = "default"
}

variable "name_prefix" {
  description = "Prefix applied to every resource name"
  type        = string
  default     = "mf-dashboard"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name_prefix))
    error_message = "name_prefix must be 3-31 lowercase alphanumeric or hyphen characters starting with a letter."
  }
}

variable "hostname" {
  description = "Optional custom domain for the dashboard. Leave empty to serve from the default *.cloudfront.net domain."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing us-east-1 ACM certificate ARN covering var.hostname. Required when hostname is set."
  type        = string
  default     = ""

  validation {
    condition     = var.hostname == "" || var.acm_certificate_arn != ""
    error_message = "acm_certificate_arn must be set when hostname is set."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC hosting the crawler task"
  type        = string
  default     = "10.20.0.0/16"
}

variable "crawler_cpu" {
  description = "Fargate CPU units for the crawler task. Chromium needs headroom; 1024 is the practical floor."
  type        = number
  default     = 2048
}

variable "crawler_memory" {
  description = "Fargate memory (MiB) for the crawler task"
  type        = number
  default     = 4096
}

variable "crawler_image_tag" {
  description = "Image tag in the crawler ECR repository that the task definition runs"
  type        = string
  default     = "latest"
}

variable "crawler_timeout_minutes" {
  description = "Upper bound for a single crawl. Money Forward's bulk refresh alone waits MAX_WAIT_MINUTES (default 20)."
  type        = number
  default     = 45
}

variable "writer_image_tag" {
  description = "Image tag in the writer ECR repository that the Lambda runs"
  type        = string
  default     = "latest"
}

variable "writer_timeout_seconds" {
  description = "Writer Lambda timeout. Bounded by how long a whole-file read-modify-write of the SQLite database takes."
  type        = number
  default     = 300

  validation {
    condition     = var.writer_timeout_seconds >= 30 && var.writer_timeout_seconds <= 900
    error_message = "writer_timeout_seconds must be between 30 and 900."
  }
}

variable "writer_memory" {
  description = "Writer Lambda memory (MiB). The whole database is held in /tmp and memory during the rewrite."
  type        = number
  default     = 2048
}

variable "database_object_key" {
  description = "S3 key of the SQLite database within the data bucket"
  type        = string
  default     = "db/moneyforward.db"
}

variable "schedule_expression" {
  description = "EventBridge Scheduler cron for the crawler, evaluated in schedule_timezone"
  type        = string
  default     = "cron(30 6,15 * * ? *)"
}

variable "schedule_timezone" {
  description = "IANA timezone the crawler schedule is evaluated in"
  type        = string
  default     = "Asia/Tokyo"
}

variable "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix holding Money Forward credentials. Must match SSM_PARAMETER_PREFIX in the crawler."
  type        = string
  default     = "/mf-dashboard"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the crawler, writer, and site build"
  type        = number
  default     = 30
}

variable "noncurrent_version_retention_days" {
  description = "How long superseded SQLite database versions are kept. Versioning is the only rollback for whole-file rewrites."
  type        = number
  default     = 30
}

variable "source_repository_url" {
  description = "Git repository CodeBuild clones to build the static site. The GitHub connection must be authorized once outside Terraform."
  type        = string
  default     = "https://github.com/ahalcyon/mf-dashboard.git"
}

variable "source_branch" {
  description = "Branch CodeBuild builds the static site from"
  type        = string
  default     = "main"
}

variable "ai_provider" {
  description = "LLM provider for the insight generator running inside the crawler. One of openai, anthropic, google. Empty disables the analytics phase's LLM call."
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "openai", "anthropic", "google"], var.ai_provider)
    error_message = "ai_provider must be one of \"\", openai, anthropic, or google."
  }
}

variable "ai_model" {
  description = "Model id passed to the configured provider. Required when ai_provider is set."
  type        = string
  default     = ""

  validation {
    condition     = (var.ai_provider == "") == (var.ai_model == "")
    error_message = "ai_provider and ai_model must be set together."
  }
}

# --- 段階的な有効化 -------------------------------------------------------
# ECR イメージの push や GitHub 接続の認可は Terraform の管理外なので、
# それらが揃うまでは依存するリソースを作らずに済むようにする。

variable "enable_writer" {
  description = "Create the writer Lambda. Requires an image already pushed to the writer ECR repository."
  type        = bool
  default     = false
}

variable "enable_site_build" {
  description = "Create the CodeBuild project and its trigger. Requires the GitHub connection to be authorized first."
  type        = bool
  default     = false
}

variable "enable_crawler_schedule" {
  description = "Enable the scheduled crawl. Requires an image already pushed to the crawler ECR repository."
  type        = bool
  default     = false
}

# --- Basic 認証 -----------------------------------------------------------

variable "basic_auth_username" {
  description = "Username for the edge Basic authentication"
  type        = string
  default     = "mf"

  validation {
    condition     = can(regex("^[A-Za-z0-9._~-]{1,64}$", var.basic_auth_username))
    error_message = "basic_auth_username must be 1-64 URL-safe characters."
  }
}

variable "basic_auth_password" {
  description = "Password for the edge Basic authentication. Leave empty to generate one; read it back from the bookmark_url output."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    # ブックマーク URL (https://user:pass@host/) に埋め込むため、区切り文字を含められない
    condition     = var.basic_auth_password == "" || can(regex("^[A-Za-z0-9._~-]{12,128}$", var.basic_auth_password))
    error_message = "basic_auth_password must be 12-128 URL-safe characters."
  }
}

variable "session_cookie_max_age_seconds" {
  description = "How long the session cookie issued after a successful Basic auth stays valid in the browser"
  type        = number
  default     = 31536000
}
