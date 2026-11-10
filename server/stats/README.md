# Serveur de statistiques DevGitBrowser

Petit serveur Node.js sans dépendance qui reçoit les statistiques **anonymes** envoyées par les navigateurs dont l'utilisateur a donné son accord, et les sert au panneau admin (`%AdminDBG%`).

## Installation (VPS Debian / Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash
# ou avec ton propre domaine (enregistrement DNS A vers le VPS) :
curl -fsSL https://raw.githubusercontent.com/hempreur/DevGitBrowser/main/server/stats/install.sh | sudo bash -s -- stats.mondomaine.fr
```

Le script installe Node.js 20, un service systemd `devgit-stats` et Caddy (HTTPS automatique). Sans domaine, il utilise un nom gratuit `devgit-<ip>.sslip.io`. Il affiche à la fin **l'adresse du serveur** et le **jeton admin**.

- L'adresse va dans `package.json` → `devgitStats.url`, puis on publie une version du navigateur.
- Le jeton se colle dans le panneau admin → « Utilisateurs dans le monde ».

## Données
Données reçues : identifiant aléatoire, version, pays de Windows, système, minutes d'utilisation et nombre de pages. L'identifiant est re-haché avec un secret du serveur. Aucune adresse IP ni adresse de site n'est enregistrée. Les données sont gardées 400 jours dans `/opt/devgit-stats/data/stats.json`.

Commandes utiles : `systemctl status devgit-stats` · `journalctl -u devgit-stats -f` · jeton : `sudo grep ADMIN_TOKEN /etc/devgit-stats.env`
