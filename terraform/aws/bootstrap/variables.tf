variable "region" {
  description = "Region holding the state bucket. Must match the backend block of the root module."
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "Named AWS profile used to provision the state bucket"
  type        = string
  default     = "default"
}

variable "name_prefix" {
  description = "Prefix applied to the bucket name. Must match the root module."
  type        = string
  default     = "mf-dashboard"
}

variable "state_version_retention_days" {
  description = "How long superseded state versions are kept. Each apply leaves one, so this is the window for rolling back a deployment."
  type        = number
  default     = 90
}
