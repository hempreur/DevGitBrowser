## 1.11.0 — Bienvenue : assistant de premier lancement, import, coffre enrichi

### Assistant de premier lancement (5 étapes)
- **Thème**, **moteur de recherche**, **protection** (DevGitShield, nuisances, mode renforcé YouTube/Twitch, VPN au démarrage avec choix du pays), **import** depuis l'ancien navigateur, **coffre à mots de passe**.
- Chaque étape peut être passée (« Plus tard ») ; tout reste modifiable dans les Paramètres.
- Nouveau réglage : Paramètres → VPN → « Connecter au démarrage ».
- Les réglages « nuisances » et « mode renforcé » s'appliquent désormais immédiatement depuis les Paramètres.

### Import depuis Chrome, Edge, Brave, Vivaldi, Opera, Opera GX et Firefox
- Détection automatique des navigateurs et de leurs profils (avec leur nom).
- Import des **favoris** et de l'**historique** (sans doublon), lus sur une copie : rien n'est modifié dans l'autre navigateur et rien n'est envoyé sur Internet.
- Si l'historique ne s'importe pas, fermer l'autre navigateur puis réessayer.
- Disponible dans l'assistant et dans Paramètres → « Importer depuis un autre navigateur ».
- **Mots de passe** : via l'export CSV officiel de chaque navigateur (instructions affichées), puis coffre → « Importer un CSV ». Les identifiants existants sont mis à jour, jamais dupliqués. Option (cochée par défaut) pour **supprimer le fichier CSV** après l'import, car il contient les mots de passe en clair.

### Coffre à mots de passe
- **Vérifier les fuites** : chaque mot de passe est comparé à la base Have I Been Pwned par k-anonymat. Seuls les 5 premiers caractères de son empreinte SHA-1 sont envoyés ; le mot de passe ne quitte jamais le PC. Les mots de passe trouvés portent un badge 🚨.
- **Générateur** : longueur de 12 à 64, chiffres et symboles au choix, bouton Copier.
- **Mes coordonnées** : fiches (nom, e-mail, téléphone, société, adresse) **chiffrées dans le coffre**. Clic droit dans un champ d'un formulaire HTTPS → « Remplir mes coordonnées ». Jamais dans les onglets privés, ni sur les champs mot de passe, cachés ou déjà remplis.

## 1.10.0 — Netflix (Widevine), DevGitShield sans casse, onglets privés sous VPN, nouveaux thèmes

### Vidéos protégées (Netflix, Prime Video, Disney+, Canal+…)
- Le navigateur passe à **Electron for Content Security (castLabs) 45.2.1**, la même version d'Electron avec en plus le module DRM **Widevine**, installé et mis à jour automatiquement en arrière-plan. Son état est visible dans À propos.
- Nouveau **lecteur protégé DevGit** (`DevGitMedia.exe`).
  - Netflix, Disney+, Prime Video, Max, Canal+, Apple TV+, Paramount+ et Crunchyroll s'y ouvrent automatiquement, dans une fenêtre séparée avec son propre profil.
  - C'est le moteur castLabs d'origine, **signé VMP** par castLabs EVS, comme ces plateformes l'exigent.
  - Le navigateur principal garde **tous ses fusibles de sécurité** : castLabs refuse de signer un moteur modifié, d'où ce lecteur séparé.
  - Les liens hors streaming sont renvoyés vers DevGitBrowser.
  - Réglage : Paramètres → Général → « Lecteur protégé ».
- La permission `mediaKeySystem` est autorisée. Elle était refusée par la politique de permissions, d'où l'erreur M7701-1003.
- La compilation se fait en plusieurs étapes : dossier, lecteur signé, installateur. La signature utilise les secrets GitHub `EVS_ACCOUNT_NAME` et `EVS_PASSWD`.

### DevGitShield : fin des sites bloqués
- Les scriptlets uBlock Origin étaient injectés **deux fois** (préchargement DevGitShield + moteur Ghostery). C'était la cause des blocages complets de YouTube et Twitch. Ils ne sont plus injectés qu'une fois, au plus tôt.
- Les protections maison YouTube/Twitch (interception de `JSON.parse`, des Workers et accélération des publicités), détectables par ces sites, passent dans un **mode renforcé facultatif**, désactivé par défaut. Le blocage s'appuie sur les filtres uBlock Origin mis à jour chaque jour (quick-fixes, unbreak).
- Le type de chaque requête est désormais celui fourni par Chromium, plus « deviné » depuis l'URL : des scripts et des images de sites légitimes étaient bloqués par erreur.
- Les listes « anti-nuisances » (cookies, pop-ups), connues pour casser des sites, deviennent facultatives, comme dans uBlock Origin.
- Nouveau raccourci dans le menu 🛡️ : « *site* ne fonctionne pas ? Mettre la protection en pause ici ».

### Nouveautés
- **Onglet privé sous VPN** : clic droit sur **+** → « Naviguer en mode privé », ou Ctrl+Maj+N.
  - L'onglet utilise une session séparée en mémoire, effacée à la fermeture du dernier onglet privé.
  - Il passe **toujours** par le VPN, avec blocage de toute connexion directe tant que le VPN n'est pas prêt et WebRTC verrouillé.
  - Rien n'est conservé : ni historique, ni restauration de session.
- **Nouveaux thèmes** : Néon, Noir, Blanc, Nature, Sable, Océan et Velours. Ce sont de vraies palettes de couleurs (fonds, surfaces, textes, accents) au lieu d'un filtre de couleur global, appliquées aussi à la radio. Les anciens choix sont repris automatiquement.
- **Météo** : le nom de la ville s'affiche à côté de la température.

## 1.9.1 — DevGit Video local (extension DevGit Store)

- DevGit Store continue à distribuer les extensions depuis le VPS. **Aucune vidéo, URL vidéo ou opération de conversion ne passe par le VPS.**
- Nouvelle extension `extensions/devgit-video/` installable depuis DevGit Store : bouton MP4/MP3 sur YouTube/Shorts, sélecteur de résolution / débit audio, enregistrement Windows.
- Le moteur yt-dlp + FFmpeg s'exécute **uniquement sur le PC Windows de l'utilisateur**, dans le processus local DevGitBrowser. Les exécutables officiels sont téléchargés et vérifiés à la compilation de l'installateur, et fournis avec le navigateur.
- Confirmation native du chemin de sauvegarde, vérification stricte des identifiants YouTube, validation du format et de la qualité, sans commande shell arbitraire. Installation de la version 1.9.1 nécessaire avant d'utiliser l'extension depuis la boutique.
- Limites : disponibilité des vidéos dépend de YouTube et des droits d'utilisation ; aucune conversion sans consentement de l'utilisateur. La qualité de réencodage MP3 n'améliore pas celle de la source.

## 1.9.0 — DevGit Store : boutique d'extensions hébergée sur le serveur DevGit

### Nouveautés
- **Extensions disponibles** (onglet Extensions) : un catalogue d'extensions est hébergé sur le serveur DevGit (VPS), avec recherche, installation et désinstallation en un clic.
  - Les autorisations demandées par l'extension sont affichées avant l'installation.
  - Les mises à jour sont automatiques, au démarrage puis toutes les 6 h.
- **Sécurité** : la connexion au serveur est épinglée (certificat vérifié par empreinte). Chaque paquet est contrôlé avant l'installation : empreinte SHA-256, chemins de fichiers sûrs (aucun fichier ne peut s'écrire hors du dossier de l'extension), manifest valide. Les extensions n'ont pas accès aux fichiers locaux.
- **Panneau admin → Boutique d'extensions** : on publie une extension en choisissant son dossier. Pour une nouvelle version, il suffit de republier. Le panneau affiche le nombre d'installations par extension et permet de retirer une extension.
- Serveur DevGit : nouvelles routes `/v1/store/*`. Pour les ajouter, relancer le script d'installation, qui conserve le jeton et le certificat.

## 1.8.0 — Statistiques mondiales, météo illustrée, horloge dans la barre d'onglets

### Nouveautés
- **Serveur de statistiques** (`server/stats/`) à installer sur un VPS en une commande, avec HTTPS automatique (Caddy) et sans dépendance.
- **Statistiques anonymes** : une bannière demande l'accord une seule fois. Le réglage est modifiable dans Paramètres → Confidentialité. Si l'utilisateur refuse, rien n'est envoyé et l'identifiant aléatoire est effacé.
- **Panneau admin « Utilisateurs dans le monde »** :
  - utilisateurs actifs (jour, 7 j, 30 j), total et nouveaux ;
  - heures passées et trafic (pages ouvertes) ;
  - classement par pays avec drapeaux ;
  - versions utilisées ;
  - graphique sur 30 jours ;
  - satisfaction (note moyenne et répartition).
  - Le jeton du serveur est stocké chiffré.
- **Note du navigateur** (1 à 5 ★) dans À propos.
- **Météo illustrée** : petites images animées (soleil, lune, éclaircies, nuages, brouillard, bruine, pluie, averses, neige, orage).
- **Horloge et météo** déplacées tout en haut à droite, au niveau des onglets.
- **Brillance du logo** : un reflet lumineux passe de gauche à droite (désactivé si Windows demande moins d'animations).

## 1.7.0 — Horloge, météo, PiP au survol des vidéos, panneau admin

### Nouveautés
- **Horloge numérique** en haut à droite (heure locale de l'ordinateur, date complète au survol). Désactivable dans Paramètres → Général.
- **Température extérieure** à côté de l'horloge : choisis ta ville dans Paramètres → Général. La source est gratuite et sans clé (Open-Meteo), avec mise à jour toutes les 20 minutes.
- **Picture-in-Picture au survol des vidéos** : un bouton semi-transparent apparaît en haut à droite de la vidéo sous le pointeur. Le bouton fixe de la barre d'outils et l'entrée du menu ☰ ont été retirés. Un bouton **Télécharger** s'ajoute quand la vidéo est un fichier direct (mp4, webm…). Le bouton est isolé de la page (Shadow DOM fermé, monde isolé).
- **Panneau admin caché** : taper `%AdminDBG%` dans la barre d'adresse.
  - L'accès demande une clé `DGB-XXXX-XXXX-XXXX-XXXX` à chaque ouverture. Seule son empreinte scrypt est stockée. Les essais sont verrouillés après 5 erreurs, avec une pause qui s'allonge.
  - Si la clé est perdue, les 3 mots de sécurité, dans l'ordre, génèrent une nouvelle clé. L'ancienne cesse alors de fonctionner.
  - Le panneau affiche les installations, les navigateurs actifs (vérifications de mise à jour par jour), l'adoption par version, les mises à jour, et les étoiles, forks et signalements GitHub. Aucune donnée n'est collectée sur les utilisateurs.

## 1.6.0 — Nouveau logo DGB et mode caché DGBx

### Nouveautés
- **Nouveau logo DGB** pour l'application (icône de l'exe, barre des tâches) et pour l'interface.
- **Mode caché DGBx** : taper `%SxOnSite%` dans la barre d'adresse ouvre une interface sombre magenta et néon, avec rangées de plateformes adultes connues (gratuites et freemium) façon catalogue vidéo, recherche, catégories, favoris ♥ et « Reprendre ».
  - Confirmation de majorité obligatoire à la première entrée, code d'accès facultatif (4 à 8 chiffres, haché avec scrypt, blocage 60 s après 5 erreurs).
  - Navigation privée dans ce mode : rien dans l'historique, la restauration de session ni les onglets fermés récemment. Les onglets du mode se ferment quand on clique sur « Quitter DGBx ».
  - La commande n'est jamais envoyée au moteur de recherche.

## 1.5.1 — MatchPulse : nouvelle source fiable pour le direct

### MatchPulse 0.6.0
- **Cause du problème** : SofaScore refuse les requêtes qui ne proviennent pas de son propre site ; aucun match n'était trouvé, et l'ancien secours ESPN ne couvrait qu'une vingtaine de championnats.
- **Nouvelle source principale : ESPN « toutes compétitions »** (gratuit, sans clé, sans compte) : le programme complet du jour en une seule requête (plus de 200 matchs un samedi), avec les dates voisines fusionnées pour les matchs du soir.
- Direct toutes les 30 s : buts, pénaltys marqués ou manqués, cartons, **fautes, corners, tirs cadrés**, via le détail officiel de chaque match.
- Probabilité avant validation calculée avec les cotes moyennes publiées par ESPN (DraftKings) et la forme des 5 derniers matchs.
- Rapprochement ticket → match amélioré (noms courts comme « PSG », abréviations).
- Bouton **« Tester la source »** : indique si ESPN répond, le nombre de matchs du jour et les compétitions disponibles.
- API-Football reste disponible avec une clé personnelle.

## 1.5.0 — VPN gratuit, coffre à mots de passe, radio, mode gaming, thèmes

### Nouveautés
- **VPN DevGit gratuit** (bouton 🌐) : le trafic du navigateur passe par le réseau chiffré Tor (adresse IP masquée, sans compte ni limite). Choix du pays de sortie (France, Pays-Bas, Suisse, États-Unis, Japon…) pour accéder aux contenus bloqués, « Nouvelle adresse IP », vérification en un clic. Fuites WebRTC bloquées pendant la connexion. Le composant Tor officiel est téléchargé par la CI et vérifié (signature GPG de Tor Browser + SHA-256).
- **Coffre à mots de passe** local : AES-256-GCM, clé dérivée du mot de passe maître (scrypt), fichier lié en plus au compte Windows (DPAPI). Proposition d'enregistrement à la connexion, remplissage sur demande (clé 🔑 dans la barre d'adresse), générateur, audit des mots de passe faibles ou réutilisés, copie effacée du presse-papiers après 30 s, verrouillage automatique (15 min, veille, verrouillage de Windows), protection contre les essais répétés.
- **Lecteur radio** (bouton 📻) : mini fenêtre avec des dizaines de milliers de stations (annuaire libre radio-browser.info), tri par pays, genre, popularité, recherche, favoris et stations récentes. La musique continue quand la fenêtre est fermée (indicateur ♪ dans la barre d'état).
- **Mode gaming** et **gestionnaire de tâches** (Maj+Échap) : mémoire et processeur par onglet, mise en veille des onglets inactifs (processus libéré), priorité du navigateur abaissée pendant les parties. Mode Éco : onglets inactifs en veille après 10 min. Les onglets restaurés au démarrage sont chargés à la demande.
- **7 thèmes de couleurs** (Néon, Océan, Émeraude, Rubis, Solaire, Graphite, Clair), modifiables à tout moment (menu ☰ → Thème ou Paramètres).
- **Message de bienvenue** au premier lancement : thème, mot de passe maître, moteur de recherche.
- Signature « By CodexHempreur » dans la même police que la marque en bas à gauche.

### MatchPulse 0.5.0
- **Ticket en préparation** : les sélections du panier sont lues avant la validation et une **probabilité de réussite estimée** s'affiche pour chaque sélection et pour le combiné (cotes du marché SofaScore sans marge, forme des 5 derniers matchs, repli sur la cote du ticket), avec la valeur par rapport à la cote proposée. Résultat 1N2, double chance, les deux équipes marquent, plus/moins de buts. Estimation statistique, jamais une garantie.

### Sécurité (audit 1.5)
- Protection **anti-hameçonnage / anti-malware** avant l'ouverture des pages (listes publiques mises à jour chaque jour, vérification locale).
- **DNS sécurisé (DNS over HTTPS)** : Cloudflare, Quad9, AdGuard, Google ou Mullvad.
- Page dédiée en cas de plantage d'un onglet, dialogue « page qui ne répond pas », alerte en cas de redémarrage du processus graphique, journal local des erreurs (jetons masqués), outils de réparation (cache, filtres, réglages).

### Corrections
- Les messages de la barre d'état étaient masqués par une ancienne règle CSS.
- Vérification des mises à jour 5 secondes après le lancement.

## 1.4.0 — Historique, favoris, onglets détachables, PiP, mises à jour automatiques

### Nouveautés
- **Historique de navigation** local (5 000 pages, recherche, suppression par page ou par période, Ctrl+H) et **suggestions** dans la barre d'adresse (favoris puis pages les plus visitées).
- **Favoris** : bouton ☆ dans la barre d'adresse (Ctrl+D), barre de favoris (Ctrl+Maj+B), gestion complète (renommer, réordonner, supprimer, ouvrir en onglet/fenêtre), accès rapide sur la page d'accueil.
- **Onglets détachables** : glisser un onglet hors de la fenêtre crée une nouvelle fenêtre ; le glisser sur une autre fenêtre le rattache ; réordonnancement par glisser-déposer. Menu clic droit des onglets (dupliquer, couper le son, déplacer vers une fenêtre, fermer les autres, rouvrir l'onglet fermé Ctrl+Maj+T).
- **Picture-in-Picture** : bouton dédié et clic droit sur une vidéo ; la vidéo reste au-dessus des autres fenêtres (y compris dans les iframes).
- **Mises à jour automatiques** : chaque version poussée sur `main` est publiée en release GitHub ; le navigateur la télécharge en arrière-plan et propose de redémarrer pour l'installer. Les onglets sont restaurés après la mise à jour.
- **À propos** : version, Chromium, Electron, système, extensions, état de DevGitShield, vérification manuelle des mises à jour, copie des informations de diagnostic.
- Restauration de la session (fenêtres et onglets), menu ☰ natif, menu contextuel des pages (ouvrir un lien dans un nouvel onglet, copier, enregistrer l'image, rechercher la sélection, inspecter…), téléchargements suivis avec progression, choix du moteur de recherche, indicateur et coupure du son par onglet, aperçu du lien survolé dans la barre d'état.

### DevGitShield (YouTube / Twitch)
- Les scriptlets uBlock Origin (`##+js`) sont désormais injectés **avant** les scripts de la page via un preload de session : auparavant ils arrivaient trop tard, d'où les publicités YouTube.
- Protection dédiée YouTube : suppression de `adPlacements` / `playerAds` / `adSlots` des réponses du lecteur, filet de sécurité qui coupe et saute une publicité qui démarrerait malgré tout, masquage des encarts et de la fenêtre anti-bloqueur.
- Protection dédiée Twitch : interception des playlists HLS du lecteur (Worker), demande d'un flux sans publicité intégrée, sinon retrait des segments publicitaires.
- Chargement tolérant des listes : une liste indisponible ne fait plus retomber le bloqueur sur les 32 règles de secours. Miroirs Ghostery, listes uBlock annuelles 2020–2026, Peter Lowe, cookies/nuisances. Les pages HTML (portails captifs) ne sont plus acceptées comme listes.
- Pause de la protection site par site, compteur de requêtes bloquées par onglet sur le bouton bouclier.

### Sécurité
- Mode **HTTPS prioritaire** (page d'avertissement avec repli HTTP explicite), page d'erreur claire pour les certificats invalides.
- User-Agent sans « Electron » (connexion Google, YouTube, Twitch), signal **Global Privacy Control / DNT**, protection de l'adresse IP locale (WebRTC).
- Avertissement avant le téléchargement de fichiers exécutables (.exe, .msi, .ps1, .js, .lnk…), confirmation avant l'ouverture d'une application externe (mailto:, etc.).
- Fusibles Electron de l'exécutable Windows : `RunAsNode`, `NODE_OPTIONS` et `--inspect` désactivés, cookies chiffrés sur disque, chargement de l'application uniquement depuis `app.asar`.
- Anti « popunder » : les liens vers un nouvel onglet sont limités en rafale et filtrés par DevGitShield.

### MatchPulse 0.4.0
- Nouvelle source **gratuite et sans clé SofaScore** (toutes compétitions, ~30 s) : buts, pénaltys (marqués/manqués), cartons (dont second jaune), VAR, **fautes et corners**. Bascule automatique sur ESPN si SofaScore ne répond pas ; API-Football reste disponible.
- **Détection automatique des tickets validés** sur Betclic, Winamax et Unibet (« pari enregistré / validé / placé… ») et bouton « Suivre les matchs de mon ticket » qui retrouve automatiquement chaque rencontre (alias PSG, OM, OL…).
- Le suivi tourne dans le module d'arrière-plan : il continue quand tu changes de page, jusqu'à 12 matchs, avec **notifications Windows** et choix des types d'alertes.

### Corrections
- Les liens `target="_blank"` étaient bloqués comme des pop-ups : ils s'ouvrent maintenant dans un nouvel onglet.
- Les notifications de l'application étaient cachées derrière la page web : elles s'affichent dans la barre d'état.
- « Occurrence suivante » de la recherche dans la page restait bloquée sur le premier résultat ; compteur 2/3 ajouté.
- Le plein écran vidéo (YouTube…) occupe désormais toute la fenêtre.
- Raccourcis clavier actifs aussi quand le focus est dans l'interface (Ctrl+T/W/L/Tab/1-9, F5, F11, F12, Alt+←/→).
- Un événement du moteur IE pouvait faire naviguer un autre onglet que le sien.
- Fermer le dernier onglet d'une fenêtre secondaire ferme la fenêtre.

### Interface
- En-tête compact et redessiné (icônes vectorielles), boutons redondants retirés (Détacher, Réseau, GitHub, recherche, DevTools : accessibles depuis le menu ☰ ou au clavier). Le bouton IE n'apparaît que sur les pages anciennes.
- Paramètres réorganisés (Général, Confidentialité et sécurité, Performances, Téléchargements, Réseau, Outils avancés).
- Signature « By CodexHempreur ».

## 1.3.9 — DevGitShield : protection publicitaire native

- Intégration du moteur de filtres Ghostery pour Electron (compatible syntaxes uBlock Origin et EasyList) à la session Chromium persistante ; aucune extension à ajouter manuellement.
- Mode maximal activé par défaut : sources EasyList, EasyPrivacy, listes uBlock pour publicités, confidentialité, nuisances, corrections, risques et compatibilité, ainsi qu'EasyList France. Téléchargement via HTTPS et mises à jour quotidiennes.
- Cache local des listes pour le démarrage hors ligne ; ensemble minimal de filtres préinstallé en cas d'absence de cache ou de réseau.
- Interrupteur d'activation globale et actualisation des filtres dans Sécurité, sans changer les autorisations caméra et microphone.
- Compatibilité conservée avec MatchPulse et les pop-ups Chromium ; l'hôte MSHTML (IE11) reste hors du périmètre des interceptions réseau d'Electron.
- Les annonces intégrées à des médias ou diffusées directement depuis le site ne peuvent pas toutes être détectées ; une protection à 100 % n'est pas garantie.
- Moteur tiers sous licence MPL-2.0 ; les listes de filtres conservent leurs licences et leurs auteurs respectifs.

## 1.3.8 — MatchPulse 0.3.0 : lecture native du DOM et alertes du bookmaker

- Lecture du ticket Betclic à partir de la structure HTML vivante (`textContent`, `innerText`, noeuds de cotes), sans capture d’écran ni API de compte.
- Association de chaque cote à son marché et sa sélection, sans emprunter celle d’un pari voisin ; exclusion des anciennes cotes barrées.
- Les sélections et les cotes visibles sont présentées avec leur provenance et une mise en garde sur leur statut (les cotes affichées peuvent différer de celles validées).
- Surveillance locale toutes les 15 secondes des scores du ticket et des annotations explicites de cartons, pénaltys et fautes déjà présentes dans le DOM de Betclic. Alerte uniquement après une modification observée.
- ESPN public et API-Football restent disponibles pour les compétitions et événements non couverts par la page.
- Ajout de tests sur la lecture d’éléments HTML, les anciennes cotes barrées, les scores et les limites d’attribution.

# DevGitBrowser 1.3.7 — MatchPulse 0.2.0

- Réparation de la lecture Betclic « En cours / Combiné » : extraction des sélections sans imposer de cote.
- Rapport explicite des sélections détectées et des cotes absentes, avec saisie optionnelle de la cote du ticket.
- Source publique ESPN sans clé en mode expérimental pour scores, buts, cartons et pénaltys, selon couverture.
- API-Football facultative maintenue pour les statistiques de fautes quand disponibles.
- Aucun accès aux comptes ou au paiement.

---

# DevGitBrowser — historique

## 1.3.6 — MatchPulse inclus

- MatchPulse 0.1.0 livré avec le navigateur et chargé automatiquement dans la session Chromium, sans GitHub.
- Ajout du dossier officiel `extensions/matchpulse` au dépôt public et à l'installateur EXE.
- Le gestionnaire distingue les extensions **INCLUSE** et **GitHub privé**.
- Déconnexion GitHub sans retirer MatchPulse ; dépôt GitHub privé ne peut pas remplacer l'extension incluse.
- Tickets et clés API conservés uniquement en mémoire par l'extension. Aucune automatisation de pari.

## 1.3.5 — CamfrogWeb ActiveX / salon historique (Windows)

- Détection ciblée de `monvisiocam.com` et de ses sous-domaines : IE11 s'exécute avec un hôte **32 bits** pour pouvoir charger d'anciens contrôles ActiveX 32 bits (contrairement au navigateur Electron 64 bits).
- Le moteur IE64 reste sélectionné pour les autres sites anciens ; les liens et fenêtres enfant d'une session IE restent dans le moteur et la même architecture.
- Ajout d'un diagnostic local, en lecture seule, pour les identifiants historiques CamfrogWeb du registre COM, sans installer, exécuter ou enregistrer automatiquement de contrôles non vérifiés. Il est affiché dans **Sécurité → Mode IE**.
- Correction Win32 des appels de changement de propriétaire de fenêtre et de la conversion d'un handle 64 bits lors de l'exécution de l'hôte 32 bits.
- Compilation de deux exécutables auxiliaires (`DevGitLegacyHost.exe` x64 et `DevGitLegacyHost32.exe` x86) ; tests natifs Windows des deux architectures et d'une fenêtre enfant IE.
- Ne désactive pas les protections Windows ActiveX, ne modifie pas les zones de sécurité et ne garantit pas qu'un plugin obsolète fonctionne sur tous les systèmes.

## 1.3.4 — Fenêtres IE persistantes et surimpression Win32

- Remplacement du reparentage Win32 `SetParent` par une surface IE11 possédée, sans bordure, positionnée sur l'onglet : amélioration du rendu au-dessus de la composition Chromium.
- Les navigations HTTP(S) restent dans une session IE11, y compris après changement de domaine ; l'autorisation automatique au prochain lancement reste limitée au domaine initialement accepté.
- Capture de `NewWindow3` / `ppDisp` : fenêtres pop-up IE réelles pour les liens `target=_blank` et `window.open`, qui ne basculent pas vers Chromium. Les descendants conservent le moteur IE11.
- Limites anti-abus des fenêtres IE (12 simultanées et 18/minute), rejet des protocoles non HTTP(S) et retour Chromium pour les domaines WebRTC incompatibles.
- Nouveau test d'intégration Windows : page HTML locale + fenêtre enfant IE ouverte depuis cette page.

## 1.3.2 — Résolution du mode IE7 implicite et repli vidéo moderne

- Hôte MSHTML Windows dédié, sans console visible, avec mode IE11 forcé pour cet exécutable uniquement (clé HKCU per-user `FEATURE_BROWSER_EMULATION=11001`).
- Vérification effective de `document.documentMode` avant de confirmer IE ✓ ; repli Chromium si le contrôle est obsolète ou si une page vidéo nécessite WebRTC.
- MonVisio et BabelVisio restent en moteur moderne (le rendu IE11 ne prend pas en charge les webcams WebRTC).
- Test de chargement Windows renforcé : exécutable dédié et mode IE11 requis avant publication.

# Version 1.3.1 — Correctif de visibilité du moteur IE (2026-11-06)

- Correctif de l’empilement natif Windows : la fenêtre enfant MSHTML est replacée au-dessus du rendu Chromium et le style WS_CHILD est fixé avant SetParent.
- Respect des coordonnées physiques Windows et du facteur d’échelle de l’écran.
- Le bouton IE indique désormais le chargement en cours et ne confirme le succès qu’après le chargement d’un document MSHTML.
- Une erreur ou un délai excessif rétablit Chromium et affiche l’explication, au lieu de laisser une page invisible.
- Test d’intégration Windows : attachement à une vraie fenêtre native et chargement d’une page HTML locale.
- Le moteur IE demeure optionnel, après consentement par site, et reste exclu pour BabelVisio/WebRTC.

# Version 1.3.0 — Intégration du mode historique à l’onglet

- Le bouton **IE** bascule désormais le **site actuel dans le même onglet**, en intégrant un contrôle Windows `WebBrowser` (MSHTML) au moyen d’un processus local placé sous la fenêtre du navigateur. Il n’ouvre plus une seconde fenêtre avec titre et barre d’adresse.
- La première activation d’un site se fait volontairement par un clic sur **IE**, puis le choix est conservé **par origine** dans les préférences de l’utilisateur ; ce site bascule automatiquement en mode ancien lors des prochaines visites. Le bouton IE permet de revenir à Chromium et de retirer l’autorisation automatique.
- Protection : aucune bascule silencieuse vers un moteur obsolète pour les sites inconnus ; la détection ActiveX/VBScript n’est qu’un indice. BabelVisio reste en Chromium. Les liens vers d’autres origines reviennent en navigation moderne.
- Les onglets, l’accueil, le zoom et les panneaux Chromium restent inchangés. **Limites :** le moteur IE n’a pas les mêmes cookies, permissions, outils réseau et capacités média que Chromium ; il repose sur des composants Windows non pris en charge dans toutes les configurations. La réalisation d’un composant natif au moyen de PowerShell/.NET ne garantit pas la prise en charge sur tous les postes.
- En cas d’échec de l’intégration Windows, repli sur Chromium et message d’erreur explicite.

## 1.2.1 — Affichage et ergonomie

- Correction du double défilement vertical dans l’interface d’accueil et les panneaux (page racine non défilante).
- Suppression effective du menu latéral gauche et de ses écouteurs ; navigation conservée en haut et récupération de la largeur dans les pages web.
- Signature de pied de page revue : plus petite, plus élégante et en style calligraphique, libellée « By Hempreur ». Tests adaptés et nouvelles vérifications d’interface.

# Historique DevGitBrowser

## 1.1.0 — Correctif webcam et paramètres (6 novembre 2026)

### Corrigé

- **BabelVisio.com** et ses sous-domaines HTTPS peuvent ouvrir des fenêtres de webcam avec `window.open()`, y compris les fenêtres `about:blank` écrites ensuite par JavaScript.
- Les fenêtres enfant conservent `window.opener` et les relations DOM nécessaires aux applications de visioconférence. Elles peuvent elles-mêmes ouvrir une fenêtre, sous les mêmes limites et règles de sécurité.
- La limite précédente de trois pop-ups/minute devient **24/minute au maximum pour BabelVisio**, et **8/minute pour les sites explicitement autorisés**, avec **24 fenêtres ouvertes simultanément au maximum par origine** et **64 globalement**.
- L'utilisateur peut révoquer explicitement l'autorisation automatique de BabelVisio dans **Sécurité → Fenêtres pop-up → Toujours bloquer**. Les anciennes listes d'autorisation de la 1.0.0 sont migrées.
- Les URL dangereuses (`javascript:`, `data:`, `file:`, `chrome:`) sont refusées pour les pop-ups ; les documents `blob:` ne sont admis que s'ils viennent de la même origine.

### Ajouté

- Commandes individuelles **Caméra / Microphone / Notifications / Géolocalisation** par origine, et choix **Demander / Autoriser / Bloquer**.
- Demande de permission pour les périphériques audio et vidéo ; contrôle séparé du partage d'écran, qui demande la sélection d'une source au moment de chaque utilisation (aucun partage silencieux).
- **Paramètres** : mode équilibré ou économique, accélération GPU (décision appliquée au prochain démarrage), zoom par site, recherche dans la page, impression, dossier de téléchargement et vidage du cache/cookies.
- Téléchargements avec fenêtre **Enregistrer sous** au lieu de lancer un exécutable automatiquement.
- Ralentissement natif des onglets en arrière-plan et réduction des synchronisations GitHub de 90 s à 5 min en mode économique. Aucun drapeau de désactivation GPU imposé par défaut pour protéger les performances vidéo.
- Tests automatisés de politique pop-up et rétrocompatibilité du panneau de sécurité.

### Limites et vérification

- Le site BabelVisio n'était pas consultable depuis l'environnement de développement. La compatibilité réelle avec l'intégralité de son code et avec chaque webcam doit être validée manuellement sur Windows.
- Les modifications ont été vérifiées par tests de logique et compilation du projet, mais cela ne remplace pas un test end-to-end des fenêtres et périphériques Windows.
- La consommation CPU/GPU varie selon les appels vidéo, le pilote graphique, les extensions chargées et le nombre d'onglets : une consommation quasi nulle n'est pas réaliste en visioconférence.
- L'installateur NSIS Windows n'est pas signé avec un certificat Authenticode, les métadonnées CodexHempreur INC ne constituent pas une signature Windows vérifiée.

## 1.2.0 — Neon / Analyse LIVE / IE Legacy (6 novembre 2026)

- **Interface néon inspirée du visuel approuvé** : barre latérale, accueil cyberpunk cyan/violet/magenta, icônes et boutons cohérents, promotion BabelVisio pour discuter, utiliser les webcams et explorer les mini-jeux (sans listes de jeux non vérifiées).
- **Icône Windows sans fond** : le symbole néon remplace le carré sombre ; PNG et ICO ont des pixels réellement transparents dans les quatre coins, sur le bureau, les raccourcis et l'installeur.
- **Analyse réseau indépendante** : fenêtre Windows dédiée, protocole DevTools Network attaché seulement pendant l'inspection de l'onglet actif, requêtes/réponses, statuts, durées, en-têtes, aperçu de réponse explicitement demandé, données sensibles filtrées, aucune journalisation sur disque. WebSockets : métadonnées de connexion, pas le trafic privé des messages.
- **Compatibilité IE historique réelle et distincte** : détection non intrusive de marqueurs anciens (ActiveX/VBScript/X-UA-Compatible), et commande *Ouvrir en mode ancien* invoquant le contrôle Windows WebBrowser (MSHTML/Trident) via une fenêtre PowerShell/WinForms sans console. Demande explicite et avertissement de sécurité avant chaque ouverture ; pas d'activation automatique sur les sites Internet.
- **Caméras Windows au premier plan** : les nouvelles pop-ups natives de BabelVisio restent au premier plan par défaut (niveau flottant), sans désactiver l'isolation et les demandes de permissions. Réglage par site, menu contextuel et raccourci Alt+Maj+P pour épingler/désépingler. Le throttling d'arrière-plan est désactivé pour ces fenêtres vidéo afin de ne pas bloquer la lecture.
- **Performances** : l'inspecteur réseau n'est actif que fenêtre ouverte, les animations décoratives ont été évitées, le GPU reste actif par défaut (meilleur rendu vidéo). Aucun gain chiffré garanti, dépend des sites et du PC.
- **Distribution** : un seul installateur Windows x64 NSIS, même profil local et même partition, code éditeur CodexHempreur INC, sans certificat Authenticode.
