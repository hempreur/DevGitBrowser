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

## Messages en direct, arrêt d'urgence, bugs et parrainage (v1.17+)
- `GET /v1/live?after=N&lock=0|1&v=…&cc=…` : connexion d'écoute des navigateurs ouverts (réponse dès qu'un message ou un changement de verrou arrive, sinon au bout de 25 s). Rien n'est enregistré.
- `GET /v1/config?v=…&cc=…` : état de l'arrêt d'urgence et des fonctions coupées, lu au lancement.
- `POST /v1/admin/messages` : envoie un message aux navigateurs ouverts (`{"text","level":"info|alert","versions","countries","url"}`).
- `PUT /v1/admin/lockdown` : arrêt d'urgence (`{"active":true,"versions":"","message":"…"}` ; `{"active":false}` pour débloquer).
- `PUT /v1/admin/features` : fonctions coupées (`{"features":["store","vpn",…]}`).
- `POST /v1/bug`, `POST /v1/referral/claim`, `GET /v1/referral/CODE` : rapports de bug et parrainage.
- `DELETE /v1/admin/messages/ID` et `DELETE /v1/admin/messages` : retire un message (ou tous) ; il disparaît aussi des navigateurs ouverts qui l'affichent. (v1.18)
- `DELETE /v1/admin/bugs` (`?status=fixed` pour les seuls corrigés) : supprime des rapports de bug. (v1.18)

## Panneau admin en temps réel et tchat de support (v1.18)
- `GET /v1/admin/watch?rev=N` : écoute du panneau admin. Le serveur répond dès qu'un événement arrive (nouvel utilisateur actif, note, rapport de bug, message, parrainage, discussion…) avec la liste des parties à recharger, sinon au bout de 25 s.
- Tchat de support : chaque rapport envoyé par un navigateur 1.18 porte l'empreinte SHA-256 d'une clé secrète gardée sur le PC de la personne. Seule l'empreinte est stockée.
  - `POST /v1/admin/support/ID/open` (`{"welcome":"…"}`) : prise en charge, la discussion s'ouvre des deux côtés ;
  - `POST /v1/admin/support/ID/messages` (`{"text"}`), `POST /v1/admin/support/ID/close`, `GET /v1/admin/support/ID` ;
  - `POST /v1/support/ID/messages` (`{"key","text"}`) : message de l'utilisateur, vérifié avec sa clé (20 messages par minute au plus) ;
  - les réponses arrivent aux navigateurs par `/v1/live` (paramètre `chat`).
- Les discussions sont enregistrées avec les rapports dans `bugs.json` (300 messages au plus par discussion) et supprimées avec eux.

### Débloquer sans le navigateur (secours)
Sur le VPS, avec le jeton admin :
```bash
curl -sk -X PUT https://127.0.0.1:8443/v1/admin/lockdown -H "Authorization: Bearer JETON" -H "Content-Type: application/json" -d '{"active":false}'
```

## Mettre à jour le serveur
Relancer la commande d'installation. Le jeton, le certificat (donc l'empreinte) et les données sont conservés.
