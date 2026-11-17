package inc.codexhempreur.devgitbrowser

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Locale
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

data class LiveMessage(val id: Long, val text: String, val level: String, val url: String)
data class Lockdown(val blocked: Boolean, val message: String, val rev: Long)

/**
 * Serveur DevGitBrowser (le même que sur PC) : statistiques anonymes, messages en direct,
 * arrêt d'urgence et annonce des nouvelles versions.
 * Certificat auto-signé ÉPINGLÉ : la connexion est coupée si son empreinte SHA-256 ne correspond pas.
 */
class Server(private val ctx: Context) {
    private val base = BuildConfig.STATS_URL.trimEnd('/')
    private val pin = BuildConfig.STATS_PIN.lowercase(Locale.ROOT).filter { it in '0'..'9' || it in 'a'..'f' }
    val available get() = base.startsWith("https://") && pin.length == 64
    private val main = Handler(Looper.getMainLooper())
    private val prefs get() = ctx.app.prefs

    var onMessage: (LiveMessage) -> Unit = {}
    var onRetract: (List<Long>) -> Unit = {}
    var onLockdown: (Lockdown) -> Unit = {}
    var onLatest: (String) -> Unit = {}

    private val ssl: SSLSocketFactory by lazy {
        val tm = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) { throw CertificateException("client") }
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                val cert = chain?.firstOrNull() ?: throw CertificateException("Aucun certificat")
                if (sha256(cert.encoded) != pin) throw CertificateException("Certificat du serveur inattendu (empreinte différente).")
            }
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }.socketFactory
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    fun request(method: String, path: String, body: JSONObject? = null, timeoutMs: Int = 15_000): Pair<Int, String> {
        val c = URL(base + path).openConnection() as HttpsURLConnection
        c.sslSocketFactory = ssl
        // L'empreinte épinglée remplace la vérification du nom (certificat auto-signé du serveur).
        c.hostnameVerifier = HostnameVerifier { _, _ -> true }
        c.requestMethod = method; c.connectTimeout = 10_000; c.readTimeout = timeoutMs; c.useCaches = false
        try {
            if (body != null) {
                c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            val stream = if (code in 200..399) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { r -> val sb = StringBuilder(); val buf = CharArray(8192); while (true) { val n = r.read(buf); if (n < 0) break; sb.append(buf, 0, n); if (sb.length > 1_000_000) break }; sb.toString() } ?: ""
            return code to text
        } finally { c.disconnect() }
    }

    private val country get() = Locale.getDefault().country.uppercase(Locale.ROOT).takeIf { Regex("^[A-Z]{2}$").matches(it) } ?: "ZZ"

    // ---- Statistiques anonymes (seulement après accord) : jamais d'adresse de site.
    @Volatile var minutes = 0
    @Volatile var pages = 0
    fun countPage() { if (prefs.telemetry == 1) pages = minOf(pages + 1, 5000) }
    fun ping() {
        if (!available || prefs.telemetry != 1) return
        val body = JSONObject().put("id", prefs.telemetryId).put("v", BuildConfig.VERSION_NAME).put("cc", country)
            .put("os", "android").put("min", minOf(minutes, 120)).put("pages", pages)
        val sentMin = minOf(minutes, 120); val sentPages = pages
        try { val (code, _) = request("POST", "/v1/ping", body); if (code in 200..299) { minutes -= sentMin; pages -= sentPages } } catch (_: Exception) {}
    }

    // ---- Canal en direct : messages, arrêt d'urgence, nouvelle version.
    @Volatile private var running = false
    private var cursor = -1L
    private var latest = ""
    val locked get() = currentLock().blocked

    fun currentLock(): Lockdown = try {
        val o = JSONObject(prefs.lockdown); Lockdown(o.optBoolean("blocked"), o.optString("message"), o.optLong("rev"))
    } catch (_: Exception) { Lockdown(false, "", 0) }

    fun start() {
        if (running || !available) return
        running = true
        Thread({ liveLoop() }, "dgb-live").apply { isDaemon = true }.start()
        Thread({
            Thread.sleep(20_000)
            while (running) { ping(); Thread.sleep(30 * 60_000L) }
        }, "dgb-ping").apply { isDaemon = true }.start()
    }

    private fun liveLoop() {
        var fails = 0
        while (running) {
            try {
                val lock = if (locked) 1 else 0
                val (code, text) = request("GET", "/v1/live?after=$cursor&lock=$lock&v=${BuildConfig.VERSION_NAME}&cc=$country", null, 40_000)
                if (code != 200) throw IllegalStateException("HTTP $code")
                apply(JSONObject(text)); fails = 0
            } catch (_: Exception) {
                fails++; Thread.sleep(minOf(60_000L, 3_000L * fails))
            }
        }
    }

    private fun apply(o: JSONObject) {
        val first = cursor < 0
        val c = o.optLong("cursor", -1); if (c >= 0) cursor = maxOf(cursor, c)
        o.optJSONObject("lockdown")?.let { l ->
            val rev = l.optLong("rev", 0)
            if (rev >= prefs.lockRev) {
                val lock = Lockdown(l.optBoolean("blocked"), l.optString("message").take(500), rev)
                val changed = lock.blocked != locked
                prefs.lockRev = rev
                prefs.lockdown = JSONObject().put("blocked", lock.blocked).put("message", lock.message).put("rev", rev).toString()
                if (changed || lock.blocked) main.post { onLockdown(lock) }
            }
        }
        if (!first) {
            o.optJSONArray("messages")?.let { a ->
                for (i in 0 until minOf(a.length(), 20)) {
                    val m = a.optJSONObject(i) ?: continue
                    val id = m.optLong("id", -1); val text = m.optString("text").trim()
                    if (id < 0 || text.isEmpty()) continue
                    cursor = maxOf(cursor, id)
                    val url = m.optString("url").takeIf { Regex("^https://\\S{3,300}$").matches(it) } ?: ""
                    val msg = LiveMessage(id, text.take(400), if (m.optString("level") == "alert") "alert" else "info", url)
                    main.post { onMessage(msg) }
                }
            }
            o.optJSONArray("retracted")?.let { a -> val ids = (0 until minOf(a.length(), 500)).map { a.optLong(it, -1) }.filter { it >= 0 }; if (ids.isNotEmpty()) main.post { onRetract(ids) } }
        }
        val l = o.optString("latest")
        if (Versions.parse(l) != null && l != latest) { latest = l; main.post { onLatest(l) } }
    }
}
