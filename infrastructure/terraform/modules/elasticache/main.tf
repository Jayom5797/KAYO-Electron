terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_sg_ids" {
  type    = list(string)
  default = []
}
variable "node_type" {
  type    = string
  default = "cache.t3.medium"
}
variable "num_nodes" {
  type    = number
  default = 2
}
variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name}-redis-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.name}-redis-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-redis-sg" })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = var.name
  description                = "Redis cluster for ${var.name}"
  node_type                  = var.node_type
  num_cache_clusters         = var.num_nodes
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.num_nodes > 1
  snapshot_retention_limit   = 3
  snapshot_window            = "03:00-04:00"
  maintenance_window         = "Mon:04:00-Mon:05:00"
  tags                       = merge(var.tags, { Name = var.name })
}

output "primary_endpoint" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
output "port"             { value = 6379 }
output "sg_id"            { value = aws_security_group.redis.id }
