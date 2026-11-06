# DevGitBrowser — CodexHempreur INC

Navigateur de développement pour **Windows 10/11 64 bits**, conçu en Electron/Chromium, en français, sans console MS-DOS au lancement une fois compilé. Logo DevGitBrowser néon intégré à la barre supérieure, à l’accueil, à la barre inférieure, aux fenêtres, au raccourci et à l’installateur Windows. Signature graphique dans la barre inférieure : **By CodexHempreur**.

## Contenu

- Onglets classiques et bouton **Détacher** : un onglet se transfère dans une **nouvelle fenêtre Windows indépendante** (même profil utilisateur, mêmes cookies et autorisations par site).
- Pop-ups : **bloqués par défaut** ; autorisation explicite par origine HTTPS dans **Sécurité** ; filtre de protocoles et limite de **3 pop-ups par minute et par origine**. Il faut parfois rafraîchir une page et recliquer sur son bouton après autorisation. Cela ne constitue pas un antivirus ou un bloqueur de publicité absolu.
- Caméra et microphone : boîte de dialogue **Refuser / Autoriser une fois / Toujours autoriser ce site**. Révocation des autorisations persistantes possible ; les permissions système Windows peuvent aussi être requises lors de l'utilisation. Géolocalisation, notification et partage d'écran refusés.
- Connexion GitHub via **jeton personnel à permissions limitées** (fine-grained PAT). Le jeton n'est pas dans le code ni dans l'installateur ; il est **chiffré via Windows DPAPI/Electron safeStorage** dans le profil local. Sans stockage chiffré, connexion refusée.
- Un **unique dépôt privé**, appartenant au compte GitHub authentifié ; son identifiant numérique est vérifié à chaque synchronisation. Aucun import manuel local. Les données sont chargées depuis l'API officielle HTTPS GitHub et les empreintes SHA-1 des objets GitHub sont vérifiées.
- Auto-détection des extensions dans `extensions/<nom>/manifest.json` sur la branche sélectionnée, **toutes les 90 secondes**, après que les fichiers ont été envoyés sur GitHub. Les extensions supprimées du dépôt sont retirées du navigateur. Synchronisation manuelle disponible.
- **Profils séparés par utilisateur Windows** via le dossier de données d'application. **Les utilisateurs ne doivent pas partager le même compte Windows.** Les autres comptes ne reçoivent jamais ton jeton ni tes extensions ; un administrateur Windows, un logiciel malveillant ou une personne ayant accès à ta session Windows reste potentiellement capable de lire des données locales. Le contrôle d'accès distant dépend aussi de la confidentialité du dépôt GitHub.
- Promotion originale et lien direct vers **https://www.BabelVisio.com** sur l'accueil. Le contenu public du site n'a pas pu être vérifié : aucune fonctionnalité du service n'est affirmée, le graphisme BV est une illustration non officielle et pas une copie du logo.
- Connexion réseau **système / directe / proxy HTTP ou SOCKS5**. Aucun tunnel VPN intégré.

> **Limite technique :** Electron ne prend en charge qu'une **partie** des API d'extensions Chrome, pas le Chrome Web Store ni les CRX. Une extension incompatible affiche une erreur dans le gestionnaire.

## Créer l'installateur Windows .exe (sans fenêtre .bat/.cmd)

Le projet utilise **electron-builder / NSIS**. L'installateur construit s'appelle :

`DevGitBrowser-Setup-1.0.0.exe`

L'installateur contient Electron, Chromium et l'application. Les utilisateurs finaux **n'ont pas besoin de Node.js** ni de lancer de `.bat`.

### Méthode 1 — GitHub Actions, sans installer les outils sur son PC

1. Crée un dépôt GitHub pour le **code source du navigateur** (distinct du dépôt privé qui contiendra tes extensions).
2. Téléverse **le contenu de ce dossier**, y compris `.github/workflows/windows-installer.yml`, à la racine de ce dépôt.
3. Va dans **Actions → Générer l'installateur Windows EXE → Run workflow**.
4. Après réussite du workflow, ouvre l'exécution puis **Artifacts → DevGitBrowser-Installateur-Windows**. GitHub fournit l'artefact dans un ZIP : après extraction, il contient **un seul installateur EXE**.
5. Pour un **lien direct vers le seul fichier EXE, sans ZIP**, publie un tag `v1.0.0` sur ce dépôt. Le workflow créera une GitHub Release avec l'EXE en téléchargement direct (si l'option Releases est autorisée sur le dépôt).

### Méthode 2 — depuis Windows, avec Node.js (pour la construction seulement)

Ouvre un terminal PowerShell dans le dossier du code source puis :

```powershell
npm install
npm test
npm run build:win
```

L'EXE sera dans `dist/`. Il est destiné à être **lancé graphiquement** (pas de fenêtre terminal/MS-DOS). Le premier téléchargement des dépendances nécessite Internet.

## Signature de l'installateur

Le nom **CodexHempreur**, la société **CodexHempreur INC**, le nom de l'application et les informations de copyright sont inscrits dans la configuration des métadonnées Windows. **Ce n'est pas une signature numérique Authenticode.** Pour que Windows affiche un éditeur authentifié plutôt que « Éditeur inconnu », il faut un certificat de signature de code valide émis à ton identité/société et configuré lors de la construction. **Aucun certificat privé n'est inclus dans ce projet.** Ne pas contourner SmartScreen.

L'installation NSIS est **par utilisateur Windows**, ne réclame pas les droits administrateur sans nécessité, et peut afficher une élévation UAC en cas de changement de dossier. Les autorisations caméra/micro sont obligatoirement soumises à une confirmation au moment de leur utilisation, pas préapprouvées lors de l'installation.

## Connecter GitHub dans le navigateur

1. Ouvre **GitHub** en haut de la fenêtre.
2. Crée sur https://github.com/settings/personal-access-tokens un **fine-grained PAT** avec `Metadata: Read` (implicite) et `Contents: Read` sur **ton dépôt privé** ; ne donne pas `Write` ni des permissions administrateur.
3. Colle le jeton dans **Jeton personnel GitHub** puis **Connecter GitHub**.
4. Saisis le **nom du dépôt**, pas son URL complète (ex. `mes-extensions`), ainsi que la branche (`main`).
5. Clique sur **Enregistrer le dépôt**. Il doit appartenir au compte authentifié, être privé et accessible en lecture.
6. Ajoute dans ton dépôt :

```text
extensions/
  mon-extension/
    manifest.json
    content.js
```

Exemple de `manifest.json` :

```json
{
  "manifest_version": 3,
  "name": "Ma première extension DevGitBrowser",
  "version": "1.0.0",
  "content_scripts": [{ "matches": ["https://example.com/*"], "js": ["content.js"] }]
}
```

Après chaque `git push` vers la branche sélectionnée, le navigateur verra l'ajout au prochain contrôle (90 secondes maximum plus le temps du téléchargement) ou via **Synchroniser maintenant**. **Les extensions ne sont pas créées ou envoyées sur GitHub automatiquement par l'application** : c'est la publication de leurs fichiers sur le dépôt privé qui déclenche leur import.

## Permissions de sécurité

- Les **pop-ups** restent bloqués initialement. Pour un site de confiance, ouvre **Sécurité** et active **Fenêtres pop-up**. En cas de refus, retente l'action après autorisation. Les pop-ups autorisés peuvent être dangereux ; n'autorise que les sites fiables.
- La **caméra** et le **micro** sont autorisables par site et révoquables dans Sécurité. Pour leur bon fonctionnement, vérifie aussi les réglages de confidentialité Windows. Les permissions dépendent d'un contexte sécurisé (HTTPS ou localhost) ; pas de caméra sur un site HTTP distant.
- Les **extensions** ont accès aux pages définies par leur manifeste et peuvent être malveillantes même si elles proviennent de TON dépôt (compte compromis, commit dangereux). Le navigateur garantit uniquement la provenance et l'intégrité des objets Git téléchargés, pas leur innocuité. Ne donne accès au dépôt qu'aux personnes de confiance ; privilégie la validation manuelle des changements sensibles.
- Ce projet est une **base de développement**, pas un navigateur ayant passé un audit de sécurité. Test de compatibilité et de sécurité sur Windows recommandé avant distribution.

## Structure

```text
DevGitBrowser/
  main.js                      Navigation, fenêtres, IPC, permissions, synchro
  preload.js                   Pont IPC restreint
  lib/validation.js            Adresses web / proxy
  lib/github-source.js         Contrôle dépôt, fichiers, empreintes
  ui/                          Interface graphique
  assets/icon.ico              Icônes multi-résolutions (EXE, installateur, raccourci)
  assets/icon.png              Icône de fenêtre 512 px
  assets/logo-mark.png         Logo intégré à l’interface
  assets/brand-source.png      Artwork source pour régénérer les icônes
  assets/generate-icon.py      Générateur PNG et ICO (Pillow)
  tests/                       Tests de validation et sécurité
  .github/workflows/           Construction automatique Windows
  package.json                 Métadonnées développeur et NSIS
```

## Références

- https://www.electronjs.org/docs/latest/api/extensions
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electron.build/docs/win/
- https://www.electron.build/docs/features/code-signing/code-signing-win/

## Identité graphique du navigateur

Le **nouveau logo néon** est inclus dans les ressources Windows et l’interface graphique. `assets/icon.ico` contient les formats 16, 24, 32, 48, 64, 128 et 256 pixels requis pour les raccourcis Windows ; `assets/icon.png` sert d'icône de fenêtre et `assets/logo-mark.png` est utilisée dans la page d'accueil et l'en-tête. L'installateur NSIS réutilise l'ICO fourni.

Pour remplacer ultérieurement l'artwork par un fichier PNG original en pleine résolution, actualise `assets/brand-source.png`, régénère les icônes avec `python assets/generate-icon.py` et relance la construction Windows. Les visuels sont issus de l'illustration DevGitBrowser et peuvent différer d'un éventuel master vectoriel original.
