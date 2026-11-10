# DevGit Video : téléchargement 100 % local (Windows)

## Architecture

- Le **VPS OVH** garde exactement son rôle actuel : catalogue DevGit Store, paquet d'extension, statistiques d'installation facultatives.
- Le **PC de l'utilisateur** télécharge la vidéo directement auprès de YouTube, fusionne les flux MP4 ou convertit en MP3 avec **yt-dlp, FFmpeg et Deno** inclus dans DevGitBrowser.
- Aucune vidéo, piste audio, URL YouTube ou opération de conversion n'est envoyée au VPS DevGit.

## Pourquoi le navigateur doit être mis à jour

Une extension Chromium chargée avec Electron ne peut pas lancer elle-même un exécutable Windows via les API standard prises en charge. Le petit pont Electron inclus à partir de **DevGitBrowser 1.9.1** utilise une boîte de dialogue Windows pour chaque sauvegarde, valide la vidéo et exécute les moteurs locaux avec des arguments strictement contrôlés. L'utilisateur final ne doit installer aucun service ou logiciel supplémentaire : une mise à jour du navigateur suffit.

Les exécutables sont récupérés au moment de la **compilation de l'installateur Windows** et inclus dans ses ressources. Le paquet d'extension, lui, reste léger et distribué exclusivement par le VPS.

## Publication dans ta boutique déjà en place

1. Fusionne et publie la mise à jour du navigateur **1.9.1** ; vérifie que GitHub Actions génère un installateur contenant `resources/video/yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `deno.exe`.
2. Sur un PC avec cette version, ouvre DevGitBrowser et entre `%AdminDBG%` dans la barre d'adresse.
3. Ouvre **Boutique d'extensions**. Saisis l'identifiant **`devgit-video`**.
4. Clique sur **Publier une extension…** et sélectionne le dossier `extensions/devgit-video/` contenant `manifest.json` et `content.js`.
5. Va dans **Mes extensions → DevGit Store** et actualise le catalogue.
6. Clique sur **Installer**, puis recharge la page YouTube. Le bouton **⬇ MP4 / MP3** apparaît sur les pages de vidéo et de Shorts.

L'extension est automatiquement mise à jour par DevGit Store selon son mécanisme existant. Ne publie pas l'ancienne extension v1 (elle réclamait un service HTTPS de conversion sur le VPS).

## Sécurité, limites et licences

- Les commandes exécutables ne sont **jamais** dérivées d'une URL arbitraire : un identifiant vidéo de 11 caractères est validé.
- Le téléchargement demande une **confirmation Windows de l'emplacement**. Aucune clé ni cookie YouTube n'est transmis au moteur local.
- Le moteur n'accepte qu'un téléchargement à la fois et limite la taille des fichiers à 2 Go.
- Comme le pont fonctionne à partir des messages d'une page YouTube, des scripts de cette page peuvent le solliciter, même quand l'extension est installée. La vérification d'origine, les limites de cadence et la confirmation native réduisent ce risque ; envisager une authentification d'extension plus forte à terme.
- YouTube peut changer son site et limiter les formats disponibles ; seuls les téléchargements autorisés doivent être effectués.
- La redistribution de FFmpeg, de Deno et de yt-dlp implique de conserver leurs licences et notices applicables dans l'installateur public.
- L'intégration ne peut être déclarée validée sur Windows/YouTube qu'après la compilation CI et des essais manuels sur la version 1.9.1.

Références : https://www.electronjs.org/docs/latest/api/extensions et https://github.com/yt-dlp/yt-dlp/wiki/EJS
