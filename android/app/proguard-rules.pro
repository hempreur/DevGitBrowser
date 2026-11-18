# DevGitBrowser : code sans réflexion ; on garde seulement les points d'entrée déclarés dans le manifeste.
-keepattributes SourceFile,LineNumberTable
# Tor : classes appelées depuis le code natif.
-keep class org.torproject.jni.** { *; }
-keep class net.freehaven.tor.control.** { *; }
-dontwarn org.torproject.jni.**
-dontwarn net.freehaven.tor.control.**
