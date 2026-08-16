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
  default = "r6i.xlarge"
}
variable "volume_size" {
  type    = number
  default = 500
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

resource "aws_security_group" "neo4j" {
  name_prefix = "${var.name}-neo4j-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 7474
    to_port         = 7474
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  ingress {
    from_port       = 7687
    to_port         = 7687
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-neo4j-sg" })
}

resource "aws_ebs_volume" "neo4j_data" {
  availability_zone = data.aws_availability_zones.available.names[0]
  size              = var.volume_size
  type              = "gp3"
  iops              = 3000
  throughput        = 125
  encrypted         = true
  tags              = merge(var.tags, { Name = "${var.name}-neo4j-data" })
}

resource "aws_instance" "neo4j" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.neo4j.id]
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e
    wget -O - https://debian.neo4j.com/neotechnology.gpg.key | apt-key add -
    echo 'deb https://debian.neo4j.com stable 5' > /etc/apt/sources.list.d/neo4j.list
    apt-get update && apt-get install -y neo4j-enterprise
    mkfs.ext4 /dev/xvdf
    mkdir -p /var/lib/neo4j/data
    mount /dev/xvdf /var/lib/neo4j/data
    echo '/dev/xvdf /var/lib/neo4j/data ext4 defaults 0 2' >> /etc/fstab
    chown -R neo4j:neo4j /var/lib/neo4j/data
    systemctl enable neo4j && systemctl start neo4j
  EOF
  )

  tags = merge(var.tags, { Name = "${var.name}-neo4j" })
}

resource "aws_volume_attachment" "neo4j_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.neo4j_data.id
  instance_id = aws_instance.neo4j.id
}

output "private_ip" { value = aws_instance.neo4j.private_ip }
output "bolt_uri"   { value = "bolt://${aws_instance.neo4j.private_ip}:7687" }
output "sg_id"      { value = aws_security_group.neo4j.id }
