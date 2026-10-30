variable "do_token" {
  description = "Token da API da DigitalOcean (TF_VAR_do_token)"
  type        = string
  sensitive   = true
}

variable "region" {
  type    = string
  default = "nyc3"
}

variable "droplet_size" {
  description = "s-1vcpu-512mb-10gb (~US$4) ou s-1vcpu-1gb (~US$6, recomendado: API + worker em Node)"
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "ssh_public_key" {
  type = string
}

variable "ssh_allowed_cidrs" {
  description = "Quem pode acessar SSH (ex.: seu IP/32)"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "domain" {
  description = "Domínio da API (A record apontando para o droplet). Vazio = <ip>.sslip.io com HTTPS automático"
  type        = string
  default     = ""
}

variable "github_owner" {
  type    = string
  default = "rounantj"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "app_env" {
  description = "Conteúdo do .env de produção (DATABASE_URL, OPENAI_API_KEY, YOUTUBE_API_KEY, afiliados...)"
  type        = string
  sensitive   = true
}
