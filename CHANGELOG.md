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
