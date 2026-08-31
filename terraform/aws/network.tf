# パブリックサブネットにパブリック IP を直付けする。
# インバウンドはセキュリティグループで全遮断する。

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.name_prefix
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = var.name_prefix
  }
}

resource "aws_subnet" "public" {
  for_each = { for index, zone in local.availability_zones : zone => index }

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value)
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.name_prefix}-public-${each.key}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.name_prefix}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "crawler" {
  name        = "${var.name_prefix}-crawler"
  description = "Egress-only security group for the crawler task"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${var.name_prefix}-crawler"
  }
}

resource "aws_vpc_security_group_egress_rule" "crawler_all" {
  security_group_id = aws_security_group.crawler.id
  description       = "Money Forward, ECR, SQS, SSM, and CloudWatch Logs"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
