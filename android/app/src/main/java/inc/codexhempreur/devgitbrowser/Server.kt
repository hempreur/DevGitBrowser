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
data class ChatMessage(val from: String, val text: String, val at: String)
data class SupportView(val bugId: String, val seq: Int, val open: Boolean, val subject: String, val messages: List<ChatMessage>)

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
    var onSupport: (SupportView) -> Unit = {}

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

    fun request(method: String, path: String, body: JSONObject? = null, timeoutMs: Int = 15_000, token: String? = null): Pair<Int, String> {
        val c = URL(base + path).openConnection() as HttpsURLConnection
        c.sslSocketFactory = ssl
        // L'empreinte épinglée remplace la vérification du nom (certificat auto-signé du serveur).
        c.hostnameVerifier = HostnameVerifier { _, _ -> true }
        c.requestMethod = method; c.connectTimeout = 10_000; c.readTimeout = timeoutMs; c.useCaches = false
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
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
    @Volatile var running = false; private set
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
                val (code, text) = request("GET", "/v1/live?after=$cursor&lock=$lock&v=${BuildConfig.VERSION_NAME}&cc=$country${chatQuery()}", null, 40_000)
                if (code != 200) throw IllegalStateException("HTTP $code")
                apply(JSONObject(text)); fails = 0
            } catch (_: Exception) {
                fails++; Thread.sleep(minOf(60_000L, 3_000L * fails))
            }
        }
    }

    private fun apply(o: JSONObject) {
        val first = cursor < 0
        val c = o.optLong("cursor", -1); if (c >= 0) { cursor = maxOf(cursor, c); prefs.msgCursor = maxOf(prefs.msgCursor, cursor) }
        for (v in parseSupport(o)) main.post { onSupport(v) }
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

    // ---- Tchat de support : clé secrète gardée sur le téléphone, seule son empreinte est sur le serveur.
    fun chats(): List<JSONObject> = try { val a = org.json.JSONArray(prefs.chats); (0 until a.length()).map { a.getJSONObject(it) } } catch (_: Exception) { emptyList() }
    private fun saveChats(list: List<JSONObject>) { prefs.chats = org.json.JSONArray(list.takeLast(5)).toString() }
    private fun chatQuery(): String {
        val list = chats().filter { Regex("^[a-f0-9]{64}$").matches(it.optString("key")) }
        return if (list.isEmpty()) "" else "&chat=" + list.joinToString(",") { it.getString("key") + ":" + it.optInt("seq", 0) }
    }
    private fun parseSupport(o: JSONObject): List<SupportView> {
        val a = o.optJSONArray("support") ?: return emptyList()
        val out = ArrayList<SupportView>()
        for (i in 0 until minOf(a.length(), 5)) {
            val v = a.optJSONObject(i) ?: continue
            val view = supportView(v) ?: continue
            out.add(view)
            val list = chats().toMutableList(); val idx = list.indexOfFirst { it.optString("bugId") == view.bugId }
            if (idx >= 0) {
                list[idx].put("seq", view.seq)
                if (!view.open && view.messages.any { it.from == "system" && it.text == "close" }) list.removeAt(idx)
                saveChats(list)
            }
        }
        return out
    }
    fun supportView(v: JSONObject): SupportView? {
        val id = v.optString("bugId"); if (!Regex("^[a-f0-9]{16}$").matches(id)) return null
        val msgs = v.optJSONArray("messages") ?: org.json.JSONArray()
        val list = (0 until minOf(msgs.length(), 300)).mapNotNull { msgs.optJSONObject(it) }.filter { it.optString("from") in setOf("admin", "user", "system") }
            .map { ChatMessage(it.optString("from"), it.optString("text").take(1000), it.optString("at").take(40)) }
        return SupportView(id, v.optInt("seq"), v.optBoolean("open"), v.optString("subject").take(140), list)
    }

    /** Rapport de bug ; renvoie son identifiant. La clé du tchat reste sur le téléphone. */
    fun sendBug(text: String, contact: String): String {
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val header = "DevGitBrowser Android ${BuildConfig.VERSION_NAME} · Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}) · ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\n"
        val (code, body) = request("POST", "/v1/bug", JSONObject().put("text", text).put("contact", contact.take(120)).put("v", BuildConfig.VERSION_NAME)
            .put("os", "android").put("cc", country).put("log", header).put("chatKey", key), 30_000)
        if (code !in 200..299) throw IllegalStateException(JSONObject(body.ifBlank { "{}" }).optString("error", "HTTP $code"))
        val id = JSONObject(body).optString("id")
        if (Regex("^[a-f0-9]{16}$").matches(id)) saveChats(chats().filter { it.optString("bugId") != id } + JSONObject().put("bugId", id).put("key", key).put("subject", text.take(140)).put("seq", 0))
        return id
    }
    /** Redemande la discussion au serveur (réouverture depuis « À propos »). */
    fun reloadChat(bugId: String) { val list = chats(); list.firstOrNull { it.optString("bugId") == bugId }?.put("seq", 0); saveChats(list) }
    fun supportSend(bugId: String, text: String): SupportView? {
        val chat = chats().firstOrNull { it.optString("bugId") == bugId } ?: throw IllegalStateException("Cette discussion est terminée.")
        val (code, body) = request("POST", "/v1/support/$bugId/messages", JSONObject().put("key", chat.getString("key")).put("text", text.take(1000)), 20_000)
        if (code !in 200..299) throw IllegalStateException(JSONObject(body.ifBlank { "{}" }).optString("error", "HTTP $code"))
        return supportView(JSONObject(body))
    }

    // ---- Parrainage
    fun referralCount(code: String): Int? = try { val (c, b) = request("GET", "/v1/referral/$code"); if (c == 200) JSONObject(b).optInt("count") else null } catch (_: Exception) { null }
    fun claimReferral(code: String): String {
        val (c, b) = request("POST", "/v1/referral/claim", JSONObject().put("code", code).put("id", prefs.telemetryId))
        // 204 : accepté ; sinon « invalid », « already » (déjà parrainé) ou « self » (son propre code).
        return if (c in 200..299) "ok" else try { JSONObject(b).optString("error", "error") } catch (_: Exception) { "error" }
    }

    /** Relève en arrière-plan (application fermée) : messages des dernières 24 h, tchat et nouvelle version. */
    fun pollBackground(): Triple<List<LiveMessage>, List<SupportView>, String> {
        val after = prefs.msgCursor
        val (code, text) = request("GET", "/v1/live?after=${if (after > 0) after else -1}&lock=${if (locked) 1 else 0}&v=${BuildConfig.VERSION_NAME}&cc=$country&bg=1${chatQuery()}", null, 20_000)
        if (code != 200) return Triple(emptyList(), emptyList(), "")
        val o = JSONObject(text)
        val msgs = ArrayList<LiveMessage>()
        if (after > 0) o.optJSONArray("messages")?.let { a ->
            for (i in 0 until minOf(a.length(), 20)) { val m = a.optJSONObject(i) ?: continue; val t = m.optString("text").trim(); if (t.isNotEmpty()) msgs.add(LiveMessage(m.optLong("id"), t.take(400), m.optString("level"), "")) }
        }
        prefs.msgCursor = maxOf(after, o.optLong("cursor", after), msgs.maxOfOrNull { it.id } ?: 0)
        o.optJSONObject("lockdown")?.let { l -> val rev = l.optLong("rev"); if (rev >= prefs.lockRev) { prefs.lockRev = rev; prefs.lockdown = JSONObject().put("blocked", l.optBoolean("blocked")).put("message", l.optString("message").take(500)).put("rev", rev).toString() } }
        return Triple(msgs, parseSupport(o), o.optString("latest"))
    }
}
