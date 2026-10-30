# Infra mais barata para a v1 em produção: 1 droplet (API + worker + Caddy/HTTPS). O Postgres é o seu (externo).
terraform {
  required_version = ">= 1.6"
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = "~> 2.40" }
  }
}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_ssh_key" "deploy" {
  name       = "cupons-br-deploy"
  public_key = var.ssh_public_key
}

resource "digitalocean_droplet" "app" {
  name       = "cupons-br"
  region     = var.region
  size       = var.droplet_size
  image      = "docker-20-04" # imagem do marketplace com Docker pronto
  ssh_keys   = [digitalocean_ssh_key.deploy.fingerprint]
  monitoring = true
  backups    = false # sem estado no droplet: o banco é externo
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    domain       = var.domain
    image_tag    = var.image_tag
    github_owner = var.github_owner
    env_file     = var.app_env
  })
}

resource "digitalocean_firewall" "app" {
  name        = "cupons-br"
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "53"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
