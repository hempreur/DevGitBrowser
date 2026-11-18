import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Une seule source de vérité : la version, le canal (« Bêta ») et le serveur viennent du package.json du navigateur.
@Suppress("UNCHECKED_CAST")
val pkg = JsonSlurper().parseText(rootProject.file("../package.json").readText()) as Map<String, Any?>
val appVersion = pkg["version"] as String
val channel = (pkg["devgitChannel"] as? String) ?: ""
@Suppress("UNCHECKED_CAST")
val stats = (pkg["devgitStats"] as? Map<String, Any?>) ?: emptyMap()
val v = appVersion.split(".").map { it.toInt() }
val keystore: String? = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

// MatchPulse : les fichiers de l'extension du navigateur PC sont copiés tels quels dans l'APK (une seule source).
val matchPulseAssets = layout.buildDirectory.dir("generated/matchpulse-assets")
val copyMatchPulse by tasks.registering(Copy::class) {
    from(rootProject.file("../extensions/matchpulse")) { include("core.js", "dom-reader.js", "content.js", "background.js", "style.css") }
    into(matchPulseAssets.map { it.dir("matchpulse") })
}
tasks.named("preBuild") { dependsOn(copyMatchPulse) }

android {
    sourceSets { getByName("main") { assets.srcDir(matchPulseAssets) } }
    namespace = "inc.codexhempreur.devgitbrowser"
    compileSdk = 35

    defaultConfig {
        applicationId = "inc.codexhempreur.devgitbrowser"
        minSdk = 26
        targetSdk = 35
        versionCode = v[0] * 10000 + v[1] * 100 + v[2]
        versionName = appVersion
        buildConfigField("String", "CHANNEL", "\"$channel\"")
        buildConfigField("String", "STATS_URL", "\"${stats["url"] ?: ""}\"")
        buildConfigField("String", "STATS_PIN", "\"${stats["pin"] ?: ""}\"")
        // Téléphones (ARM 64 et 32 bits) : limite la taille ajoutée par Tor.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    // Deux versions : « github » (APK publié sur GitHub, mise à jour intégrée) et « play » (Google Play,
    // qui interdit qu'une appli se mette à jour elle-même : la mise à jour passe par le Store).
    flavorDimensions += "store"
    productFlavors {
        create("github") { dimension = "store"; buildConfigField("boolean", "SELF_UPDATE", "true") }
        create("play") { dimension = "store"; buildConfigField("boolean", "SELF_UPDATE", "false") }
    }

    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Sans la clé officielle (pull requests), l'APK est signé avec une clé de test et n'est pas publié.
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
        }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    // Tor officiel du Guardian Project (Maven Central).
    implementation("info.guardianproject:tor-android:0.4.8.17.2")
    implementation("info.guardianproject:jtorctl:0.4.5.7")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
