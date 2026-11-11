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

## Messages en direct, arrêt d'urgence, bugs et parrainage (v1.17)
- `GET /v1/live?after=N&lock=0|1&v=…&cc=…` : connexion d'écoute des navigateurs ouverts (réponse dès qu'un message ou un changement de verrou arrive, sinon au bout de 25 s). Rien n'est enregistré.
- `GET /v1/config?v=…&cc=…` : état de l'arrêt d'urgence et des fonctions coupées, lu au lancement.
- `POST /v1/admin/messages` : envoie un message aux navigateurs ouverts (`{"text","level":"info|alert","versions","countries","url"}`).
- `PUT /v1/admin/lockdown` : arrêt d'urgence (`{"active":true,"versions":"","message":"…"}` ; `{"active":false}` pour débloquer).
- `PUT /v1/admin/features` : fonctions coupées (`{"features":["store","vpn",…]}`).
- `POST /v1/bug`, `POST /v1/referral/claim`, `GET /v1/referral/CODE` : rapports de bug et parrainage.

### Débloquer sans le navigateur (secours)
Sur le VPS, avec le jeton admin :
```bash
curl -sk -X PUT https://127.0.0.1:8443/v1/admin/lockdown -H "Authorization: Bearer JETON" -H "Content-Type: application/json" -d '{"active":false}'
```

## Mettre à jour le serveur
Relancer la commande d'installation. Le jeton, le certificat (donc l'empreinte) et les données sont conservés.
