# Publier DevGitBrowser sur Google Play

Le workflow GitHub « Application Android » fabrique deux fichiers à chaque version :

| Fichier | Pour quoi | Où le trouver |
|---|---|---|
| `DevGitBrowser-Android-x.y.z.apk` | Installation directe (site, GitHub). Se met à jour tout seul. | Dans la release GitHub |
| `DevGitBrowser-PlayStore-x.y.z.aab` | Google Play. Pas de mise à jour intégrée (Google l'interdit, c'est le Store qui s'en charge). | Onglet *Actions* → dernière exécution « Application Android » → *Artifacts* |

## 1. Créer le compte (une seule fois)
1. https://play.google.com/console → créer un compte développeur (25 $ une fois, vérification d'identité).
2. Les nouveaux comptes **personnels** doivent faire un **test fermé** (environ 12 testeurs pendant 14 jours) avant la publication publique. Les règles évoluent : vérifie-les dans la Console au moment de publier.

## 2. Créer l'application
- Nom : **DevGitBrowser**
- Langue par défaut : Français (France)
- Type : Application · Gratuite
- **Signature** : accepter « Signature d'application Play ». La clé `devgitbrowser-release.jks` sert de **clé d'importation** (c'est elle qui signe l'AAB produit par GitHub).

## 3. Fiche du Store
**Description courte (80 caractères max)**
> Navigateur rapide et privé : bloqueur de pubs, coffre à mots de passe, mode Tor.

**Description complète**
> DevGitBrowser est un navigateur gratuit, léger et respectueux de ta vie privée.
>
> • DevGitShield bloque publicités et traqueurs (listes EasyList, EasyPrivacy, Peter Lowe, Liste FR).
> • Protection anti-hameçonnage : avertissement avant d'ouvrir un site dangereux connu, vérification 100 % locale.
> • HTTPS prioritaire : connexion chiffrée dès que possible.
> • Onglets privés : ni historique ni cookies conservés.
> • Mode Tor intégré : les sites ne voient pas ton adresse IP.
> • Coffre à mots de passe chiffré par la puce de sécurité du téléphone, import depuis Chrome, Edge, Firefox, Brave ou Bitwarden.
> • Webcam et micro autorisés site par site, vidéos en Picture-in-Picture.
> • Succès à débloquer et parrainage.
> • Le même navigateur existe sur PC (Windows).
>
> Aucune publicité, aucune revente de données. Statistiques anonymes uniquement si tu l'acceptes.

**Catégorie** : Communication · **Tags** : navigateur, confidentialité
**E-mail de contact** : ton adresse de contact
**Site** : https://hempreur.github.io/DevGitBrowser/
**Règles de confidentialité** : https://hempreur.github.io/DevGitBrowser/android-privacy.html

**Images** (dans `docs/` ou à faire) : icône 512×512 (`assets/icon.png`), bannière 1024×500, au moins 2 captures d'écran de téléphone.

## 4. Questionnaires de la Console
**Sécurité des données**
- Données collectées :
  - *Identifiants de l'appareil ou autres* → identifiant aléatoire des statistiques (facultatif, avec accord), non lié à l'identité.
  - *Activité dans l'appli* → temps d'utilisation et nombre de pages (facultatif, avec accord). Jamais les sites visités.
  - *Plantages / diagnostics* → rapport de bug envoyé volontairement, avec un contact facultatif.
- Données partagées avec des tiers : **aucune**.
- Chiffrées en transit : **oui**. Suppression possible sur demande : **oui** (contact).
- Mots de passe, favoris et historique : **restent sur le téléphone**, jamais envoyés.

**Classification du contenu** : navigateur web (accès non filtré à Internet).

**Autorisations sensibles**
- Caméra, micro, position : utilisées seulement quand un site les demande, avec ton accord site par site.
- Notifications : messages de l'éditeur, réponses du support, alertes MatchPulse.
- `REQUEST_INSTALL_PACKAGES` : **absente de la version Play** (seulement dans l'APK GitHub).

**Point d'attention : MatchPulse.** Il s'active sur des sites de paris sportifs. Google encadre strictement les applis liées aux jeux d'argent. MatchPulse ne fait que lire les matchs, sans parier, mais Google peut demander des précisions lors de l'examen. Si l'appli est refusée pour ce motif, on pourra retirer MatchPulse de la version Play uniquement.

## 5. Envoyer une version
1. Télécharger `DevGitBrowser-PlayStore-x.y.z.aab` depuis l'onglet *Actions*.
2. Console → *Tests* → *Test fermé* (puis *Production*) → *Créer une version* → importer l'AAB.
3. Notes de version : copier la section du `CHANGELOG.md`.
