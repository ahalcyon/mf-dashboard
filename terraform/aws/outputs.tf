output "rds_endpoint" {
  description = "PostgreSQL endpoint (host:port)"
  value       = aws_db_instance.this.endpoint
}

output "database_url" {
  description = "Connection string for DATABASE_URL (.env)"
  value       = local.database_url
  sensitive   = true
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN holding DATABASE_URL (for ECS task definitions)"
  value       = aws_secretsmanager_secret.database_url.arn
}
