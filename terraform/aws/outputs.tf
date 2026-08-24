output "site_url" {
  description = "Public dashboard URL"
  value       = var.hostname == "" ? "https://${aws_cloudfront_distribution.site.domain_name}" : "https://${var.hostname}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution serving the dashboard"
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name to point a CNAME at when using a custom hostname"
  value       = aws_cloudfront_distribution.site.domain_name
}

output "data_bucket" {
  description = "Bucket holding the SQLite database"
  value       = aws_s3_bucket.data.id
}

output "database_uri" {
  description = "S3 URI of the SQLite database"
  value       = "s3://${aws_s3_bucket.data.id}/${var.database_object_key}"
}

output "site_bucket" {
  description = "Bucket holding the exported static site"
  value       = aws_s3_bucket.site.id
}

output "write_queue_url" {
  description = "FIFO queue the crawler publishes database writes to"
  value       = aws_sqs_queue.writes.url
}

output "write_message_group_id" {
  description = "MessageGroupId every producer must use so writes stay serialized"
  value       = local.write_message_group_id
}

output "crawler_repository_url" {
  description = "ECR repository the crawler image is pushed to"
  value       = aws_ecr_repository.crawler.repository_url
}

output "writer_repository_url" {
  description = "ECR repository the writer Lambda image is pushed to"
  value       = aws_ecr_repository.writer.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster running the crawler task"
  value       = aws_ecs_cluster.this.name
}

output "site_build_project" {
  description = "CodeBuild project that bakes the database into the static site"
  value       = one(aws_codebuild_project.site[*].name)
}
