terraform {
  required_version = "1.16.0"

  # state は平文の機密値を含む。バケットは bootstrap モジュールが作る。
  backend "s3" {
    bucket = "mf-dashboard-tfstate-769813884566"
    key    = "aws/terraform.tfstate"
    region = "ap-northeast-1"

    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.61.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "2.3.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.0"
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

# CloudFront が参照する ACM 証明書は us-east-1 に置く。
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
