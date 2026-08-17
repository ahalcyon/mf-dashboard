variable "aws_region" {
  description = "AWS region for the RDS instance"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Prefix for AWS resource names"
  type        = string
  default     = "mf-dashboard"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "moneyforward"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "mf_dashboard"
}

variable "db_engine_version" {
  description = "PostgreSQL major engine version"
  type        = string
  default     = "17"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is enough for a single-user dashboard"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GiB"
  type        = number
  default     = 20
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to PostgreSQL (e.g. your home IP as x.x.x.x/32). Keep this as narrow as possible"
  type        = list(string)
  validation {
    condition     = length(var.allowed_cidr_blocks) > 0
    error_message = "allowed_cidr_blocks must contain at least one CIDR block."
  }
  validation {
    condition     = !contains(var.allowed_cidr_blocks, "0.0.0.0/0")
    error_message = "Do not open PostgreSQL to the entire internet (0.0.0.0/0)."
  }
}

variable "publicly_accessible" {
  description = "Whether the RDS instance gets a public IP. Required for the local viewer / crawler until everything moves into the VPC"
  type        = bool
  default     = true
}
