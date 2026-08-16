terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "kayo-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "kayo-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = local.common_tags }
}

locals {
  common_tags = {
    Project     = "kayo"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "key_name" {
  type    = string
  default = ""
}

# ── VPC ──────────────────────────────────────────────────────────────────────
module "vpc" {
  source = "../../modules/vpc"
  name   = "kayo-production"
  azs    = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  tags   = local.common_tags
}

# ── ECR ──────────────────────────────────────────────────────────────────────
module "ecr" {
  source = "../../modules/ecr"
  name   = "kayo"
  tags   = local.common_tags
}

# ── EKS ──────────────────────────────────────────────────────────────────────
module "eks" {
  source     = "../../modules/eks"
  cluster_name = "kayo-production"
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
  tags       = local.common_tags
}

# ── RDS (PostgreSQL) ─────────────────────────────────────────────────────────
module "rds" {
  source          = "../../modules/rds"
  name            = "kayo-production"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  allowed_sg_ids  = [module.eks.cluster_security_group_id]
  db_password     = var.db_password
  tags            = local.common_tags
}

# ── ElastiCache (Redis) ───────────────────────────────────────────────────────
module "redis" {
  source          = "../../modules/elasticache"
  name            = "kayo-production"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  allowed_sg_ids  = [module.eks.cluster_security_group_id]
  tags            = local.common_tags
}

# ── MSK (Kafka) ───────────────────────────────────────────────────────────────
module "kafka" {
  source          = "../../modules/msk"
  name            = "kayo-production"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  allowed_sg_ids  = [module.eks.cluster_security_group_id]
  tags            = local.common_tags
}

# ── Neo4j ─────────────────────────────────────────────────────────────────────
module "neo4j" {
  source          = "../../modules/neo4j"
  name            = "kayo-production"
  vpc_id          = module.vpc.vpc_id
  subnet_id       = module.vpc.private_subnet_ids[0]
  allowed_sg_ids  = [module.eks.cluster_security_group_id]
  key_name        = var.key_name
  tags            = local.common_tags
}

# ── ClickHouse ────────────────────────────────────────────────────────────────
module "clickhouse" {
  source          = "../../modules/clickhouse"
  name            = "kayo-production"
  vpc_id          = module.vpc.vpc_id
  subnet_id       = module.vpc.private_subnet_ids[0]
  allowed_sg_ids  = [module.eks.cluster_security_group_id]
  key_name        = var.key_name
  tags            = local.common_tags
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "eks_cluster_endpoint"    { value = module.eks.cluster_endpoint }
output "rds_endpoint"            { value = module.rds.endpoint }
output "redis_endpoint"          { value = module.redis.primary_endpoint }
output "kafka_bootstrap_brokers" { value = module.kafka.bootstrap_brokers_tls }
output "neo4j_bolt_uri"          { value = module.neo4j.bolt_uri }
output "clickhouse_http"         { value = module.clickhouse.http_endpoint }
output "ecr_repositories"        { value = module.ecr.repository_urls }
