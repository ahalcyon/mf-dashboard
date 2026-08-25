terraform {
  required_version = "1.15.9"

  # state には Basic 認証のパスワードなど平文の機密値が入るため、
  # git へは置かず S3 に暗号化して保管する。バージョニングにより
  # apply ごとの断面が残る。バケットは bootstrap モジュールが作る。
  #
  # backend の設定は変数を受け付けないため、値はここに直接書く。
  backend "s3" {
    bucket = "mf-dashboard-tfstate-769813884566"
    key    = "aws/terraform.tfstate"
    region = "ap-northeast-1"

    encrypt = true
    # Terraform 1.10 以降は S3 だけでロックできる。DynamoDB は不要。
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
