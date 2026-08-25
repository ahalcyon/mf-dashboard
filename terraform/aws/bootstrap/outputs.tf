output "state_bucket" {
  description = "Bucket the root module stores its state in. Use it in the backend block."
  value       = aws_s3_bucket.state.id
}
