#!/usr/bin/env bash
# Installation du serveur de statistiques DevGitBrowser sur un VPS Debian / Ubuntu.
#
#   curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash
#
# Mode par défaut « séparé » : le serveur écoute seul en HTTPS sur le port 8443 avec son propre
# certificat (épinglé par le navigateur). Il ne touche ni aux ports 80/443, ni à Docker, ni aux
# autres services du VPS.
# Option : DEVGIT_MODE=caddy pour passer par Caddy sur 80/443 (uniquement si ces ports sont libres).
set -euo pipefail
BRANCH="${DEVGIT_BRANCH:-main}"
REPO_RAW="https://raw.githubusercontent.com/hempreur/DevGitBrowser/${BRANCH}/server/stats"
APP_DIR=/opt/devgit-stats
ENV_FILE=/etc/devgit-stats.env
MODE="${DEVGIT_MODE:-standalone}"
PORT="${DEVGIT_PORT:-8443}"

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
command -v apt-get >/dev/null || { echo "Ce script est prévu pour Debian / Ubuntu."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=600 -y -qq"
rm -f /etc/apt/apt.conf.d/99devgit-lock

echo "==> Paquets de base"
$APT update
$APT install curl ca-certificates openssl >/dev/null

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  $APT install nodejs >/dev/null
fi
node -v

echo "==> Domaine"
DOMAIN="${1:-}"
IP="$(curl -fsS4 https://api.ipify.org || true)"
if [ -z "$DOMAIN" ]; then
  [ -n "$IP" ] || { echo "Adresse IP publique introuvable : relance avec ton domaine en argument."; exit 1; }
  DOMAIN="devgit-$(echo "$IP" | tr . -).sslip.io"
fi
echo "Domaine : $DOMAIN"

if [ "$MODE" = "standalone" ] && ss -ltnH "( sport = :$PORT )" | grep -q . && ! systemctl is-active --quiet devgit-stats; then
  echo "Le port $PORT est déjà utilisé par un autre programme. Relance avec DEVGIT_PORT=<autre port>."; exit 1
fi

echo "==> Application"
id devgitstats >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin devgitstats
mkdir -p "$APP_DIR/data" "$APP_DIR/tls"
# Toujours la toute dernière version : l'API GitHub n'a pas le cache de quelques minutes de raw.githubusercontent.com.
curl -fsSL -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/hempreur/DevGitBrowser/contents/server/stats/server.js?ref=${BRANCH}" -o "$APP_DIR/server.js.new" \
  || curl -fsSL "$REPO_RAW/server.js?nocache=$(date +%s)" -o "$APP_DIR/server.js.new"
node --check "$APP_DIR/server.js.new" && mv -f "$APP_DIR/server.js.new" "$APP_DIR/server.js"
echo "    version du serveur : $(grep -o "API_VERSION = [0-9]*" "$APP_DIR/server.js" | grep -o "[0-9]*$" || echo "ancienne")"
TOKEN=""
[ -f "$ENV_FILE" ] && TOKEN="$(grep '^ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "$TOKEN" ] || TOKEN="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"

if [ "$MODE" = "standalone" ]; then
  if [ ! -s "$APP_DIR/tls/cert.pem" ]; then
    SAN="DNS:$DOMAIN"; [ -n "$IP" ] && SAN="$SAN,IP:$IP"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
      -subj "/CN=$DOMAIN/O=DevGitBrowser Stats" -addext "subjectAltName=$SAN" \
      -keyout "$APP_DIR/tls/key.pem" -out "$APP_DIR/tls/cert.pem" 2>/dev/null
  fi
  printf 'PORT=%s\nHOST=0.0.0.0\nDATA_DIR=%s/data\nADMIN_TOKEN=%s\nTLS_CERT=%s/tls/cert.pem\nTLS_KEY=%s/tls/key.pem\n' \
    "$PORT" "$APP_DIR" "$TOKEN" "$APP_DIR" "$APP_DIR" > "$ENV_FILE"
  URL="https://$DOMAIN:$PORT"
else
  PORT=8787
  printf 'PORT=%s\nHOST=127.0.0.1\nDATA_DIR=%s/data\nADMIN_TOKEN=%s\n' "$PORT" "$APP_DIR" "$TOKEN" > "$ENV_FILE"
  URL="https://$DOMAIN"
fi
chmod 600 "$ENV_FILE"
chown -R devgitstats:devgitstats "$APP_DIR"
chmod 600 "$APP_DIR/tls/key.pem" 2>/dev/null || true

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
AmbientCapabilities=
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable devgit-stats >/dev/null 2>&1
systemctl restart devgit-stats

if [ "$MODE" = "standalone" ]; then
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT/tcp" >/dev/null; fi
else
  echo "==> HTTPS (Caddy)"
  if ss -ltnH '( sport = :443 or sport = :80 )' | grep -qv caddy; then echo "Ports 80/443 déjà utilisés : relance sans DEVGIT_MODE (mode séparé)."; exit 1; fi
  if ! command -v caddy >/dev/null; then
    $APT install debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    $APT update && $APT install caddy >/dev/null
  fi
  mkdir -p /etc/caddy/conf.d
  grep -q 'import conf.d/\*' /etc/caddy/Caddyfile 2>/dev/null || echo 'import conf.d/*' >> /etc/caddy/Caddyfile
  printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > /etc/caddy/conf.d/devgit-stats.caddy
  systemctl enable --now caddy >/dev/null 2>&1; systemctl restart caddy
fi

sleep 3
echo
CURL_OPTS="-fsS"; [ "$MODE" = "standalone" ] && CURL_OPTS="-fsSk"
if curl $CURL_OPTS "$URL/health" >/dev/null 2>&1; then echo "✅ Serveur en ligne : $URL"; else echo "⚠️  Pas de réponse sur $URL/health — envoie : journalctl -u devgit-stats -n 30"; fi
echo
echo "Adresse du serveur : $URL"
if [ "$MODE" = "standalone" ]; then
  FP="$(openssl x509 -in "$APP_DIR/tls/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
  echo "Empreinte          : $FP"
  echo "(Adresse + empreinte sont publiques : envoie-les pour les intégrer au navigateur.)"
fi
echo "Jeton admin        : $TOKEN"
echo "(Le jeton est SECRET : colle-le seulement dans le panneau admin %AdminDBG%.)"
