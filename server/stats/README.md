# Serveur de statistiques DevGitBrowser

Petit serveur Node.js sans dépendance qui reçoit les statistiques **anonymes** envoyées par les navigateurs dont l'utilisateur a donné son accord, et les sert au panneau admin (`%AdminDBG%`).

## Installation (VPS Debian / Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash
# ou avec ton propre domaine (enregistrement DNS A vers le VPS) :
curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash -s -- stats.mondomaine.fr
```

Le script installe Node.js 20 et un service systemd `devgit-stats`. Par défaut, le serveur est **séparé** de tout le reste : il écoute seul en HTTPS sur le port **8443**, avec son propre certificat que le navigateur épingle par empreinte SHA-256. Il ne touche ni aux ports 80/443, ni à Docker, ni aux autres services. Sans domaine, il utilise un nom gratuit `devgit-<ip>.sslip.io`. À la fin, il affiche **l'adresse**, **l'empreinte** et le **jeton admin**.

- L'adresse et l'empreinte vont dans `package.json` → `devgitStats.url` / `devgitStats.pin`, puis on publie une version du navigateur.
- `DEVGIT_MODE=caddy` permet plutôt de passer par Caddy sur 80/443, uniquement si ces ports sont libres.
- Le jeton se colle dans le panneau admin → « Utilisateurs dans le monde ».

## Données
Données reçues : identifiant aléatoire, version, pays de Windows, système, minutes d'utilisation et nombre de pages. L'identifiant est re-haché avec un secret du serveur. Aucune adresse IP ni adresse de site n'est enregistrée. Les données sont gardées 400 jours dans `/opt/devgit-stats/data/stats.json`.

Commandes utiles : `systemctl status devgit-stats` · `journalctl -u devgit-stats -f` · jeton : `sudo grep ADMIN_TOKEN /etc/devgit-stats.env`

## Boutique d'extensions (DevGit Store)
Les extensions publiées depuis le panneau admin sont stockées dans `/opt/devgit-stats/data/store/`. Le catalogue public se trouve à `GET /v1/store/catalog`. La publication et le retrait demandent le jeton admin.

## Configuration distante, bugs et parrainage (v1.13)
- `GET /v1/config?v=1.13.0&cc=FR` : messages ciblés et arrêt d'urgence (public, rien n'est enregistré).
- `POST /v1/bug` : rapports de bug (5 par heure et par IP, 500 conservés) dans `data/bugs.json`.
- `POST /v1/referral/claim` et `GET /v1/referral/CODE` : parrainages (un par installation).
- `/v1/admin/config`, `/v1/admin/bugs` : réservés au jeton admin, utilisés par le panneau admin.

## Mettre à jour le serveur
Relancer la commande d'installation. Le jeton, le certificat (donc l'empreinte) et les données sont conservés.
