package inc.codexhempreur.devgitbrowser

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Coffre des mots de passe : chiffré en AES-256-GCM avec une clé du Keystore Android
 * (elle ne quitte jamais la puce de sécurité du téléphone). Affichage protégé par le verrouillage de l'écran.
 */
class Vault(ctx: Context) {
    private val file = File(ctx.filesDir, "vault.bin")
    private val alias = "dgb-vault"
    val entries = ArrayList<Credential>()
    @Volatile var unlockedUntil = 0L

    init { try { load() } catch (_: Exception) {} }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return gen.generateKey()
    }

    private fun load() {
        if (!file.exists()) return
        val data = file.readBytes()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        val a = JSONArray(String(c.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
        entries.clear()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i); entries.add(Credential(o.getString("o"), o.optString("u"), o.getString("p"))) }
    }

    private fun save() {
        val a = JSONArray(); for (e in entries) a.put(JSONObject().put("o", e.origin).put("u", e.username).put("p", e.password))
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        val tmp = File(file.path + ".tmp"); tmp.writeBytes(c.iv + c.doFinal(a.toString().toByteArray(Charsets.UTF_8))); tmp.renameTo(file)
    }

    fun add(list: List<Credential>): Int {
        var n = 0
        for (e in list) { entries.removeAll { it.origin == e.origin && it.username == e.username }; entries.add(e); n++ }
        entries.sortWith(compareBy({ UrlTools.display(it.origin) }, { it.username })); save(); return n
    }
    fun remove(e: Credential) { entries.remove(e); save() }
    fun clear() { entries.clear(); save() }
    fun forOrigin(origin: String) = entries.filter { it.origin == origin || UrlTools.host(it.origin).let { h -> h.isNotEmpty() && (UrlTools.host(origin) == h || UrlTools.host(origin).endsWith(".$h")) } }
    val unlocked get() = System.currentTimeMillis() < unlockedUntil
}

data class Release(val version: String, val apkUrl: String, val size: Long, val page: String)

/**
 * Mises à jour : nouvelle version publiée sur GitHub (APK DevGitBrowser-Android-x.y.z.apk), annoncée aussi
 * en direct par le serveur. Android demande toujours à l'utilisateur de confirmer l'installation.
 */
class Updater(private val ctx: Context) {
    private val main = Handler(Looper.getMainLooper())
    @Volatile var available: Release? = null; private set
    @Volatile var checking = false; private set

    fun check(onResult: (Release?, String?) -> Unit) {
        // Version Google Play : les mises à jour passent par le Store.
        if (!BuildConfig.SELF_UPDATE) { main.post { onResult(null, null) }; return }
        if (checking) return
        checking = true
        Thread({
            var err: String? = null; var rel: Release? = null
            try {
                // Les versions Android ont leurs propres releases (tag « android-v1.0.1 ») : on prend la plus récente.
                val list = JSONArray(Net.get("https://api.github.com/repos/hempreur/DevGitBrowser/releases?per_page=30", headers = mapOf("Accept" to "application/vnd.github+json")))
                rel = AndroidReleases.pick(list, BuildConfig.VERSION_NAME)
            } catch (e: Exception) { err = e.message ?: "erreur" }
            available = rel; checking = false
            main.post { onResult(rel, err) }
        }, "dgb-update").apply { isDaemon = true }.start()
    }

    fun download(rel: Release, onProgress: (Int) -> Unit, onDone: (File?, String?) -> Unit) {
        Thread({
            val out = File(ctx.cacheDir, "update.apk")
            try {
                val c = URL(rel.apkUrl).openConnection() as HttpURLConnection
                c.instanceFollowRedirects = true; c.connectTimeout = 20_000; c.readTimeout = 30_000
                c.setRequestProperty("User-Agent", "DevGitBrowser-Android")
                val total = c.contentLengthLong.takeIf { it > 0 } ?: rel.size
                var done = 0L; var last = -1
                c.inputStream.use { input -> out.outputStream().use { o ->
                    val buf = ByteArray(65536)
                    while (true) { val n = input.read(buf); if (n < 0) break; o.write(buf, 0, n); done += n
                        val p = if (total > 0) (done * 100 / total).toInt() else 0
                        if (p != last) { last = p; main.post { onProgress(p) } } }
                } }
                c.disconnect()
                main.post { onDone(out, null) }
            } catch (e: Exception) { main.post { onDone(null, e.message ?: "erreur") } }
        }, "dgb-update-dl").apply { isDaemon = true }.start()
    }

    /** Remise du fichier à l'installateur d'Android (qui vérifie la signature et demande la confirmation). */
    fun install(apk: File) {
        val pi = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            s.openWrite("devgitbrowser.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pending = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java), flags)
            s.commit(pending.intentSender)
        }
    }
}

class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
            confirm?.let { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(it) }
        }
    }
}

/** Choisit, parmi les releases GitHub, la version Android la plus récente plus récente que [current]. */
object AndroidReleases {
    private val TAG = Regex("^android-v(\\d+\\.\\d+\\.\\d+)$")
    fun pick(list: JSONArray, current: String): Release? {
        var best: Release? = null
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            if (o.optBoolean("draft") || o.optBoolean("prerelease")) continue
            val v = TAG.matchEntire(o.optString("tag_name"))?.groupValues?.get(1) ?: continue
            if (!Versions.newer(v, current) || (best != null && !Versions.newer(v, best.version))) continue
            val assets = o.optJSONArray("assets") ?: continue
            for (j in 0 until assets.length()) {
                val a = assets.optJSONObject(j) ?: continue
                if (a.optString("name") == "DevGitBrowser-Android-$v.apk") best = Release(v, a.optString("browser_download_url"), a.optLong("size"), o.optString("html_url"))
            }
        }
        return best
    }
}
