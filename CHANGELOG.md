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
