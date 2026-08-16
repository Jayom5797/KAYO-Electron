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
variable "instance_type" {
  type    = string
  default = "kafka.t3.small"
}
variable "kafka_version" {
  type    = string
  default = "3.5.1"
}
variable "num_brokers" {
  type    = number
  default = 3
}
variable "volume_size" {
  type    = number
  default = 100
}
variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_security_group" "msk" {
  name_prefix = "${var.name}-msk-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 9092
    to_port         = 9092
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  ingress {
    from_port       = 9094
    to_port         = 9094
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-msk-sg" })
}

resource "aws_kms_key" "msk" {
  description             = "MSK encryption key for ${var.name}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_msk_configuration" "main" {
  name           = "${var.name}-config"
  kafka_versions = [var.kafka_version]

  server_properties = <<-EOT
    auto.create.topics.enable=true
    default.replication.factor=3
    min.insync.replicas=2
    num.partitions=6
    log.retention.hours=168
    delete.topic.enable=true
  EOT
}

resource "aws_msk_cluster" "main" {
  cluster_name           = var.name
  kafka_version          = var.kafka_version
  number_of_broker_nodes = var.num_brokers

  broker_node_group_info {
    instance_type   = var.instance_type
    client_subnets  = var.subnet_ids
    security_groups = [aws_security_group.msk.id]

    storage_info {
      ebs_storage_info {
        volume_size = var.volume_size
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
    encryption_at_rest_kms_key_arn = aws_kms_key.msk.arn
  }

  configuration_info {
    arn      = aws_msk_configuration.main.arn
    revision = aws_msk_configuration.main.latest_revision
  }

  open_monitoring {
    prometheus {
      jmx_exporter  { enabled_in_broker = true }
      node_exporter { enabled_in_broker = true }
    }
  }

  tags = merge(var.tags, { Name = var.name })
}

output "bootstrap_brokers_tls" { value = aws_msk_cluster.main.bootstrap_brokers_tls }
output "sg_id"                 { value = aws_security_group.msk.id }
output "cluster_arn"           { value = aws_msk_cluster.main.arn }
