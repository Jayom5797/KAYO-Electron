terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "name" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "services" {
  type = list(string)
  default = [
    "control-plane",
    "detection-engine",
    "telemetry-ingestion",
    "graph-engine",
    "ai-explainer",
    "deployment-orchestrator",
    "frontend"
  ]
}

resource "aws_ecr_repository" "services" {
  for_each             = toset(var.services)
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, { Name = "${var.name}/${each.key}" })
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = toset(var.services)
  repository = "${var.name}/${each.key}"
  depends_on = [aws_ecr_repository.services]

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 production images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Remove untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }
    ]
  })
}

output "repository_urls" {
  value = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "registry_id" {
  value = values(aws_ecr_repository.services)[0].registry_id
}
