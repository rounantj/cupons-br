output "ip" {
  value = digitalocean_droplet.app.ipv4_address
}

output "api_url" {
  value = var.domain != "" ? "https://${var.domain}" : "https://${replace(digitalocean_droplet.app.ipv4_address, ".", "-")}.sslip.io"
}
