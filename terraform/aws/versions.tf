terraform {
  required_version = "1.15.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.61.0"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.name_prefix
      ManagedBy = "terraform"
    }
  }
}

# CloudFront が参照する ACM 証明書は us-east-1 にしか置けない。
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.name_prefix
      ManagedBy = "terraform"
    }
  }
}
