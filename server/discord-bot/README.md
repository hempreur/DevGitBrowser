# DevGitBrowser Bot — fonctionnement 24 h/24 sur VPS

Service Discord indépendant du serveur DevGitBrowser existant. Il n'a besoin d'aucun port entrant ni d'une clé GitHub.

## Fonctionnalités

- `/ticket` et boutons : ticket **privé** pour installation, bug, VPN/confidentialité, candidature bêta ou autre. Un seul ticket ouvert par utilisateur.
- Bouton **Archiver le ticket** : retire l'accès au demandeur, conserve l'historique pour l'équipe.
- `/suggestion` et formulaire : publie une idée dans `#idees-et-suggestions` avec réactions 👍 / 👎.
- `/mes-roles` : ajout/retrait volontaire du rôle `🔔 Alertes versions` (pas de ping automatique du rôle).
- `/installer-panneaux` (administrateurs) : crée les panneaux interactifs dans `#entraide`, `#idees-et-suggestions` et `#general`. Évite les doublons sur les 50 derniers messages.
- Accueil optionnel dans `#bienvenue` si `ENABLE_WELCOME=true` et si l'intent **Server Members** est activé dans le Developer Portal.
- Journal des ouvertures/fermetures dans `#journal-automations`, s'il existe.

Le bot **ne lit pas** le contenu des conversations (pas d'intent Message Content), ne collecte aucun mot de passe et ne requiert aucun accès administrateur Discord. Les tickets sont des salons Discord, pas des données stockées dans une base externe. Il ne modifie pas les salons communautaires existants ni ne supprime de messages.

**Indépendant** de `DISCORD_WEBHOOK_RELEASES` : les releases continuent d'être annoncées par GitHub Actions, même si ce bot est arrêté.

## Prérequis

- Un VPS Debian ou Ubuntu avec Docker Engine + plugin Docker Compose opérationnels ; `docker compose version` doit fonctionner. Pour installer Docker, suivre la documentation officielle : https://docs.docker.com/engine/install/
- `DevGitBrowser Bot` déjà invité sur votre serveur Discord, avec les scopes `bot` et `applications.commands`.
- Permissions bot minimales : **Gérer les salons**, **Gérer les rôles**, **Voir les salons**, **Envoyer des messages**, **Lire l'historique**, **Intégrer les liens**, **Ajouter des réactions**, et autorisations appropriées dans les salons cibles. Le rôle du bot doit être **au-dessus** de `🔔 Alertes versions`. Pas besoin d'Administrator.
- ID de serveur `DISCORD_GUILD_ID` et token **actuel** du bot `DISCORD_BOT_TOKEN`. Si un ancien token a été affiché dans un chat ou un terminal partagé, **Reset Token** d'abord.
- Le rôle `🛡️ Modération` (déjà prévu par le kit) est recommandé pour l'accès du staff aux tickets. Sans ce rôle, seul le bot et l'auteur pourront les voir.

## Installation sur le VPS (sans interrompre les autres services)

Si le dépôt DevGitBrowser est déjà présent, rendez-vous dans `server/discord-bot`. Sinon :

```bash
cd /opt
git clone --depth 1 https://github.com/hempreur/DevGitBrowser.git DevGitBrowser-discord
cd /opt/DevGitBrowser-discord/server/discord-bot
cp .env.example .env
chmod 600 .env
nano .env
```

Dans `.env` **sur le VPS uniquement**, définissez un token **réinitialisé**, le bon identifiant de serveur et laissez `ENABLE_WELCOME=false` au départ. Ne collez jamais un token dans GitHub, Discord ou un message ChatGPT.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

Le premier démarrage enregistre les commandes slash du serveur. Dans un salon Discord où vous êtes administrateur, exécutez **`/installer-panneaux` une seule fois**. Vérifiez ensuite les panneaux et testez un ticket (en tant que membre standard si possible).

Pour les mises à jour :

```bash
cd /opt/DevGitBrowser-discord
git pull --ff-only
cd server/discord-bot
docker compose up -d --build
```

Pour arrêter uniquement le bot : `docker compose down`. Cela ne coupe pas les autres services DevGitBrowser.

## Accueil et modération

L'accueil automatique nécessite une autorisation distincte : Developer Portal → Application → Bot → **Server Members Intent**. Après activation, mettez `ENABLE_WELCOME=true` dans `.env` et redémarrez le conteneur. Si l'intent n'est pas activé, le bot risque de ne pas pouvoir se connecter ; laissez `false` par défaut.

Pour l'antispam, les liens dangereux et les mentions abusives, activez plutôt **Discord AutoMod natif** dans Paramètres du serveur → Modération / Sécurité. Le bot n'accorde pas de bannissements automatiques et n'analyse pas les messages privés. Vérifiez aussi les permissions des rôles de modération et des catégories.

## Diagnostic

- `docker compose logs --tail=100` : connexion, commandes et erreurs (sans imprimer le token).
- Si `Missing Permissions` : montez le rôle du bot au-dessus de **🔔 Alertes versions** et vérifiez ses autorisations dans les salons.
- Si `Unknown Interaction` : vérifiez la connectivité sortante du VPS, la réponse peut avoir expiré.
- Si les commandes ne s'affichent pas : vérifier `applications.commands` et que le bot est invité sur le **bon** serveur.
- Si le webhook GitHub ne publie pas : cela ne dépend **pas** de ce bot, vérifiez le secret GitHub `DISCORD_WEBHOOK_RELEASES` et l'étape correspondante de GitHub Actions.
- Les tickets archivés conservent leurs messages dans `🗃️ TICKETS ARCHIVÉS`. Ne publiez pas d'informations sensibles dans ces salons.

## Conception et sécurité

Le conteneur est indépendant, sans ports exposés, avec un système de fichiers en lecture seule et sans privilèges élevés. Le token est fourni par une variable d'environnement locale au VPS, exclue de Docker build et ignorée par Git. Il reste consultable par les administrateurs Docker de l'hôte : limitez l'accès au VPS. Les interactions sont limitées au serveur configuré et tous les messages générés neutralisent les mentions de masse sauf la mention ciblée de l'auteur dans son ticket.
