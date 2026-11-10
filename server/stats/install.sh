#!/usr/bin/env bash
# Installation du serveur de statistiques DevGitBrowser sur un VPS Debian / Ubuntu.
# Usage :  curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash
#          (ou avec ton domaine : ... | sudo bash -s -- stats.mondomaine.fr)
set -euo pipefail
REPO_RAW="https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats"
APP_DIR=/opt/devgit-stats
ENV_FILE=/etc/devgit-stats.env
PORT=8787

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
command -v apt-get >/dev/null || { echo "Ce script est prévu pour Debian / Ubuntu."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Paquets de base"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "==> Domaine"
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS4 https://api.ipify.org || true)"
  [ -n "$IP" ] || { echo "Adresse IP publique introuvable : relance avec ton domaine en argument."; exit 1; }
  # sslip.io : nom de domaine gratuit pointant vers l'IP (certificat HTTPS possible).
  DOMAIN="devgit-$(echo "$IP" | tr . -).sslip.io"
fi
echo "Domaine : $DOMAIN"

echo "==> Application"
id devgitstats >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin devgitstats
mkdir -p "$APP_DIR/data"
curl -fsSL "$REPO_RAW/server.js" -o "$APP_DIR/server.js"
chown -R devgitstats:devgitstats "$APP_DIR"
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  printf 'PORT=%s\nHOST=127.0.0.1\nDATA_DIR=%s/data\nADMIN_TOKEN=%s\n' "$PORT" "$APP_DIR" "$TOKEN" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
TOKEN="$(grep '^ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"

cat > /etc/systemd/system/devgit-stats.service <<UNIT
[Unit]
Description=DevGitBrowser - serveur de statistiques
After=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
User=devgitstats
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now devgit-stats >/dev/null
systemctl restart devgit-stats

echo "==> HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
mkdir -p /etc/caddy/conf.d
grep -q 'import conf.d/\*' /etc/caddy/Caddyfile 2>/dev/null || {
  # Caddyfile par défaut remplacé seulement s'il n'a jamais été personnalisé.
  if grep -q '^:80' /etc/caddy/Caddyfile 2>/dev/null; then echo 'import conf.d/*' > /etc/caddy/Caddyfile; else echo 'import conf.d/*' >> /etc/caddy/Caddyfile; fi
}
cat > /etc/caddy/conf.d/devgit-stats.caddy <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

sleep 4
echo
if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then echo "✅ Serveur en ligne : https://$DOMAIN"; else echo "⚠️  Le certificat HTTPS peut prendre une minute. Vérifie : curl https://$DOMAIN/health"; fi
echo
echo "Adresse du serveur : https://$DOMAIN"
echo "Jeton admin        : $TOKEN"
echo "(Colle ce jeton dans le panneau admin %AdminDBG% → Serveur de statistiques.)"
