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
