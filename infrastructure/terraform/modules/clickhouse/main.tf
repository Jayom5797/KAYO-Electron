terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "allowed_sg_ids" {
  type    = list(string)
  default = []
}
variable "instance_type" {
  type    = string
  default = "r6i.2xlarge"
}
variable "volume_size" {
  type    = number
  default = 1000
}
variable "key_name" {
  type    = string
  default = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_security_group" "clickhouse" {
  name_prefix = "${var.name}-clickhouse-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 8123
    to_port         = 8123
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  ingress {
    from_port       = 9000
    to_port         = 9000
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-clickhouse-sg" })
}

resource "aws_ebs_volume" "clickhouse_data" {
  availability_zone = data.aws_availability_zones.available.names[0]
  size              = var.volume_size
  type              = "gp3"
  iops              = 6000
  throughput        = 250
  encrypted         = true
  tags              = merge(var.tags, { Name = "${var.name}-clickhouse-data" })
}

resource "aws_instance" "clickhouse" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.clickhouse.id]
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e
    apt-get install -y apt-transport-https ca-certificates curl gnupg
    curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" > /etc/apt/sources.list.d/clickhouse.list
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y clickhouse-server clickhouse-client
    mkfs.ext4 /dev/xvdf
    mkdir -p /var/lib/clickhouse
    mount /dev/xvdf /var/lib/clickhouse
    echo '/dev/xvdf /var/lib/clickhouse ext4 defaults 0 2' >> /etc/fstab
    chown -R clickhouse:clickhouse /var/lib/clickhouse
    systemctl enable clickhouse-server && systemctl start clickhouse-server
  EOF
  )

  tags = merge(var.tags, { Name = "${var.name}-clickhouse" })
}

resource "aws_volume_attachment" "clickhouse_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.clickhouse_data.id
  instance_id = aws_instance.clickhouse.id
}

output "private_ip"    { value = aws_instance.clickhouse.private_ip }
output "http_endpoint" { value = "http://${aws_instance.clickhouse.private_ip}:8123" }
output "sg_id"         { value = aws_security_group.clickhouse.id }
