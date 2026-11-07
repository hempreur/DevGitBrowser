## Version 1.3.4 — interface IE Tab et liens IE persistants

- **Rendu natif visible dans l'onglet** : le moteur IE11 est présenté par une fenêtre Win32 **sans bordure**, liée comme fenêtre *possédée* à DevGitBrowser, exactement positionnée sur la zone du site. Cela évite le réaffichage noir des anciens essais `SetParent` entre processus. La surface est masquée lors du changement d'onglet, de l'ouverture d'un panneau ou de la minimisation.
- **Liens et redirections dans IE** : une session IE11 conserve le moteur pour les navigations HTTP(S) que vous suivez, même lorsque vous changez de domaine. Les domaines supplémentaires ne sont **pas automatiquement ajoutés** aux autorisations persistantes IE.
- **Fenêtres IE `window.open()` / `target=_blank`** : elles sont créées comme de véritables fenêtres WebBrowser/MSHTML, avec prise en charge de `ppDisp` afin que leurs liens et leurs éventuelles fenêtres enfants restent dans IE. Une limite de 12 fenêtres simultanées et 18 ouvertures/minute réduit les abus ; le contenu non HTTP(S) est refusé.
- **Sécurité** : l'activation initiale reste volontaire par domaine et le moteur historique demeure moins sûr que Chromium. Les domaines de visioconférence modernes BabelVisio/MonVisio restent sous Chromium car IE11 ne gère pas WebRTC.
- **Vérification Windows** : un test natif effectue un chargement dans la surface IE11 et vérifie qu'une fenêtre enfant de test est bien chargée par MSHTML. La compilation CI est bloquée si ce test échoue.

# DevGitBrowser 1.3.4 — compatibilité IE Tab (moteur MSHTML natif)

Le moteur MSHTML intégré utilise désormais `DevGitLegacyHost.exe` (compilé pendant GitHub Actions) plutôt que `powershell.exe`. Le programme configure la valeur par-utilisateur `FEATURE_BROWSER_EMULATION` **uniquement pour ce programme** (IE11 standards mode). Les sites de webcams modernes tels que MonVisio/BabelVisio utilisent Chromium, car MSHTML ne prend pas en charge la capture WebRTC ; ils ne sont pas présentés comme chargés en IE si l’écran demeure noir.

# DevGitBrowser 1.3.1 — CodexHempreur INC

Navigateur de développement pour **Windows 10/11 64 bits**, conçu en Electron/Chromium, en français, sans console MS-DOS au lancement une fois compilé. Logo DevGitBrowser néon intégré à la barre supérieure, à l’accueil, à la barre inférieure, aux fenêtres, au raccourci et à l’installateur Windows. Signature graphique dans la barre inférieure : **By Hempreur** en style calligraphique discret.

Les changements de la version 1.1.0 sont détaillés dans [CHANGELOG.md](CHANGELOG.md).
Cette révision **1.2.1** corrige le double ascenseur vertical, retire le menu latéral gauche redondant et affine la signature du pied de page.



## Mode historique intégré à l’onglet (1.3.0)

Sur Windows, le bouton **IE** tente d’afficher la page actuelle dans le même onglet en hébergeant un contrôle MSHTML Windows natif. Le processus est distinct de Chromium, mais la fenêtre est ancrée dans la zone de page du navigateur, sans seconde fenêtre d’application. Le premier clic active et mémorise explicitement le site ; les visites suivantes utilisent automatiquement le mode historique pour le même site. Un second clic revient au moteur moderne et retire l’autorisation.

Par sécurité, les pages inconnues restent en Chromium, même quand des indices d’ActiveX/VBScript sont détectés. Les sites modernes, BabelVisio et la visioconférence ne doivent pas utiliser MSHTML. Le partage des cookies et de la session, les DevTools réseau Chromium et les webcams ne sont pas garantis dans ce mode. La disponibilité de MSHTML et la capacité d’intégration des fenêtres dépendent de Windows et de ses règles DPI/sécurité ; un échec provoque un retour au mode moderne. Aucun test graphique réel sur tous les systèmes Windows n’est possible depuis l’environnement de développement.

## Contenu

- Onglets classiques et bouton **Détacher** : un onglet se transfère dans une **nouvelle fenêtre Windows indépendante** (même profil utilisateur, mêmes cookies et autorisations par site).
- Pop-ups : **BabelVisio.com est autorisé par défaut** pour les fenêtres webcam (y compris `window.open('', ...)`), et tous les autres sites restent bloqués avant décision explicite dans **Sécurité**. Limites : **24 ouvertures/minute sur BabelVisio**, **8/minute sur un autre site autorisé**, **24 fenêtres ouvertes par origine, 64 globalement**. Les fenêtres enfant peuvent ouvrir leurs propres fenêtres sous contrôle. Cela ne remplace pas un antivirus ou un bloqueur publicitaire complet.
- Caméra et microphone : boîte de dialogue **Refuser / Autoriser une fois / Toujours autoriser ce site**, et choix indépendants par origine. Géolocalisation et notifications bloquées initialement mais configurables. Le partage d'écran requiert une action utilisateur et une **sélection de source à chaque tentative**. Les permissions système Windows peuvent aussi être nécessaires.
- Connexion GitHub via **jeton personnel à permissions limitées** (fine-grained PAT). Le jeton n'est pas dans le code ni dans l'installateur ; il est **chiffré via Windows DPAPI/Electron safeStorage** dans le profil local. Sans stockage chiffré, connexion refusée.
- Un **unique dépôt privé**, appartenant au compte GitHub authentifié ; son identifiant numérique est vérifié à chaque synchronisation. Aucun import manuel local. Les données sont chargées depuis l'API officielle HTTPS GitHub et les empreintes SHA-1 des objets GitHub sont vérifiées.
- Auto-détection des extensions dans `extensions/<nom>/manifest.json` sur la branche sélectionnée, **toutes les 90 secondes (mode équilibré) ou 5 minutes (mode éco)**, après que les fichiers ont été envoyés sur GitHub. Les extensions supprimées du dépôt sont retirées du navigateur. Synchronisation manuelle disponible.
- **Profils séparés par utilisateur Windows** via le dossier de données d'application. **Les utilisateurs ne doivent pas partager le même compte Windows.** Les autres comptes ne reçoivent jamais ton jeton ni tes extensions ; un administrateur Windows, un logiciel malveillant ou une personne ayant accès à ta session Windows reste potentiellement capable de lire des données locales. Le contrôle d'accès distant dépend aussi de la confidentialité du dépôt GitHub.
- Promotion originale et lien direct vers **https://www.BabelVisio.com** sur l'accueil. Le contenu public du site n'a pas pu être vérifié : aucune fonctionnalité du service n'est affirmée, le graphisme BV est une illustration non officielle et pas une copie du logo.
- Paramètres de navigation : recherche dans la page (`Ctrl+F`), zoom (`Ctrl++`, `Ctrl+-`, `Ctrl+0`), impression (`Ctrl+P`), téléchargements avec « Enregistrer sous », effacement de cache et données, mode équilibré/éco, accélération GPU paramétrable (redémarrage nécessaire).
- Connexion réseau **système / directe / proxy HTTP ou SOCKS5**. Aucun tunnel VPN intégré.

> **Limite technique :** Electron ne prend en charge qu'une **partie** des API d'extensions Chrome, pas le Chrome Web Store ni les CRX. Une extension incompatible affiche une erreur dans le gestionnaire.

## Créer l'installateur Windows .exe (sans fenêtre .bat/.cmd)

Le projet utilise **electron-builder / NSIS**. L'installateur construit s'appelle :

`DevGitBrowser-Setup-1.1.0.exe`

L'installateur contient Electron, Chromium et l'application. Les utilisateurs finaux **n'ont pas besoin de Node.js** ni de lancer de `.bat`.

### Méthode 1 — GitHub Actions, sans installer les outils sur son PC

1. Crée un dépôt GitHub pour le **code source du navigateur** (distinct du dépôt privé qui contiendra tes extensions).
2. Téléverse **le contenu de ce dossier**, y compris `.github/workflows/windows-installer.yml`, à la racine de ce dépôt.
3. Va dans **Actions → Générer l'installateur Windows EXE → Run workflow**.
4. Après réussite du workflow, ouvre l'exécution puis **Artifacts → DevGitBrowser-Installateur-Windows**. GitHub fournit l'artefact dans un ZIP : après extraction, il contient **un seul installateur EXE**.
5. Pour un **lien direct vers le seul fichier EXE, sans ZIP**, publie un tag `v1.1.0` sur ce dépôt. Le workflow créera une GitHub Release avec l'EXE en téléchargement direct (si l'option Releases est autorisée sur le dépôt).

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

- Les **pop-ups BabelVisio.com HTTPS sont autorisés par défaut**, sauf si tu les bloques dans **Sécurité → Fenêtres pop-up**. Les autres sites restent bloqués jusqu'à ton accord. Les ouvertures multiples restent soumises aux limites anti-abus, et aucun filtre ne détecte 100 % des publicités nuisibles.
- La **caméra** et le **micro** sont autorisables séparément et révoquables dans Sécurité. Pour leur bon fonctionnement, vérifie aussi les réglages de confidentialité Windows. Les permissions dépendent d'un contexte sécurisé (HTTPS ou localhost) ; pas de caméra sur un site HTTP distant.
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


## 1.2.0 : nouveautés et limites techniques

### Analyseur réseau en direct

- Clique sur **◉ Réseau**, dans la barre supérieure ou le rail latéral : la fenêtre d'analyse indépendante s'ouvre et capture les appels de **l'onglet actif** via le protocole Chrome DevTools (CDP).
- Le site inspecté et sa navigation sont visibles à travers les requêtes `GET/POST`, réponses HTTP, états et en-têtes. Les corps de réponse **textuels** sont accessibles uniquement après clic sur « Afficher », limités à 48 Ko. Les données secrètes courantes sont masquées, sans garantie d'anonymisation parfaite.
- Le journal n'est conservé **qu'en mémoire** pendant l'ouverture du moniteur, limité à 400 requêtes ; il n'est ni envoyé à GitHub ni écrit sur disque. Les fenêtres pop-up indépendantes et le trafic des autres logiciels ne sont pas capturés.
- L'ouverture simultanée des DevTools peut interrompre l'attachement réseau CDP : utilise « Reconnecter » après avoir fermé DevTools.

### Pages anciennes : Internet Explorer/MSHTML **sans Edge**

- DevGitBrowser conserve **Chromium** pour la navigation courante, la visioconférence et les extensions. Il recherche automatiquement certains marqueurs des pages anciennes (ActiveX, VBScript, directives IE, doctype ancien) et t'en informe.
- « **IE • Ouvrir le site en mode ancien** » permet de démarrer, après confirmation, une fenêtre **Windows native** basée sur le composant `System.Windows.Forms.WebBrowser`/MSHTML (Trident historique d'Internet Explorer), lorsque Windows le fournit. Il ne passe pas par Edge.
- Ce mécanisme reste **manuel**, car l'ouverture automatique d'un moteur obsolète sur des pages web externes serait dangereuse. Il n'a pas les permissions/cookies/extensions du navigateur principal, certains sites et fonctions modernes ne marchent pas, et les règles de sécurité Windows peuvent empêcher le lancement.
- Microsoft ne prend plus en charge l'application IE autonome sur Windows 11. Le composant d'intégration MSHTML est une compatibilité héritée et ne doit servir qu'à des applications de confiance. N'y saisissez pas de mots de passe ou d'informations bancaires. Le fichier PowerShell de compatibilité est inclus sous `legacy/` et déployé dans `app.asar.unpacked`.

### Pop-ups webcam Windows toujours visibles

- Depuis **Sécurité du site → Fenêtres webcam Windows au premier plan**, choisis « comportement par défaut », « toujours » ou « fenêtres classiques ». Le comportement par défaut épingle uniquement les pop-ups autorisées de BabelVisio.
- Ces pop-ups sont de **vraies fenêtres Windows Electron** avec leur relation `window.opener` préservée. Le menu clic droit et le raccourci **Alt+Maj+P** permettent de désactiver l'épinglage fenêtre par fenêtre.
- Les autorisations *caméra/micro/partage écran* restent indépendantes du placement de la fenêtre. Le navigateur ne lance pas l'application Windows Caméra ; il utilise le périphérique Windows via WebRTC et une fenêtre Windows native.

### BabelVisio

L'accueil fait la promotion du site officiel `https://www.BabelVisio.com` comme espace de discussions, webcams et mini-jeux, éléments spécifiés par le propriétaire de DevGitBrowser. La page BabelVisio ne s'est pas laissée consulter depuis l'environnement de développement au moment de la mise à jour : aucun nom de mini-jeu, nombre de participants ou garantie de service n'a été inventé. Toutes les publicités sont internes au navigateur, sans injecter de code publicitaire dans les pages web.

### Icône transparente et identité

Le nouveau symbole PNG/ICO généré conserve son alpha transparent ; pas de plaque carrée sombre. Le `generate-icon.py` utilise `assets/brand-source.png` (logo de référence) pour reconstruire les tailles de 16 à 256 pixels pour Windows. La société et le développeur restent CodexHempreur INC / CodexHempreur ; une véritable signature Authenticode nécessite un certificat distinct.
