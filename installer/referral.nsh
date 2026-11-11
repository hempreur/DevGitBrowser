; DevGitBrowser — parrainage automatique (v1.16)
; L'installateur note son propre chemin : au premier lancement, le navigateur lit la
; « marque du web » de ce fichier (adresse de la page de téléchargement, avec ?ref=CODE).
!macro customInstall
  WriteRegStr HKCU "Software\DevGitBrowser" "InstallerPath" "$EXEPATH"
!macroend
!macro customUnInstall
  DeleteRegKey HKCU "Software\DevGitBrowser"
!macroend
