terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "kayo-terraform-state"
    key            = "dev/terraform.tfstate"
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
    Environment = "dev"
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

# ── VPC (single AZ for cost savings in dev) ──────────────────────────────────
module "vpc" {
  source = "../../modules/vpc"
  name   = "kayo-dev"
  azs    = ["${var.aws_region}a", "${var.aws_region}b"]
  tags   = local.common_tags
}

# ── ECR (shared with production — same repos, different tags) ─────────────────
module "ecr" {
  source = "../../modules/ecr"
  name   = "kayo"
  tags   = local.common_tags
}

# ── EKS (smaller nodes for dev) ──────────────────────────────────────────────
module "eks" {
  source       = "../../modules/eks"
  cluster_name = "kayo-dev"
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
  node_groups = {
    system = {
      instance_types = ["t3.medium"]
      min_size       = 1
      max_size       = 3
      desired_size   = 2
      disk_size      = 50
      labels         = { "workload-type" = "system" }
      taints         = []
    }
  }
  tags = local.common_tags
}

# ── RDS (single-AZ, smaller instance for dev) ────────────────────────────────
module "rds" {
  source         = "../../modules/rds"
  name           = "kayo-dev"
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnet_ids
  allowed_sg_ids = [module.eks.cluster_security_group_id]
  db_password    = var.db_password
  tags           = local.common_tags
}

# ── ElastiCache (single node for dev) ────────────────────────────────────────
module "redis" {
  source         = "../../modules/elasticache"
  name           = "kayo-dev"
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnet_ids
  allowed_sg_ids = [module.eks.cluster_security_group_id]
  tags           = local.common_tags
}

# ── MSK (single broker for dev) ──────────────────────────────────────────────
module "kafka" {
  source         = "../../modules/msk"
  name           = "kayo-dev"
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = [module.vpc.private_subnet_ids[0]]
  allowed_sg_ids = [module.eks.cluster_security_group_id]
  tags           = local.common_tags
}

# ── Neo4j (single EC2 instance for dev) ──────────────────────────────────────
module "neo4j" {
  source         = "../../modules/neo4j"
  name           = "kayo-dev"
  vpc_id         = module.vpc.vpc_id
  subnet_id      = module.vpc.private_subnet_ids[0]
  allowed_sg_ids = [module.eks.cluster_security_group_id]
  key_name       = var.key_name
  tags           = local.common_tags
}

# ── ClickHouse (single EC2 instance for dev) ─────────────────────────────────
module "clickhouse" {
  source         = "../../modules/clickhouse"
  name           = "kayo-dev"
  vpc_id         = module.vpc.vpc_id
  subnet_id      = module.vpc.private_subnet_ids[0]
  allowed_sg_ids = [module.eks.cluster_security_group_id]
  key_name       = var.key_name
  tags           = local.common_tags
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "eks_cluster_endpoint"    { value = module.eks.cluster_endpoint }
output "rds_endpoint"            { value = module.rds.endpoint }
output "redis_endpoint"          { value = module.redis.primary_endpoint }
output "kafka_bootstrap_brokers" { value = module.kafka.bootstrap_brokers_tls }
output "neo4j_bolt_uri"          { value = module.neo4j.bolt_uri }
output "clickhouse_http"         { value = module.clickhouse.http_endpoint }
output "ecr_repositories"        { value = module.ecr.repository_urls }
