package inc.codexhempreur.devgitbrowser

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.Locale

class App : Application() {
    lateinit var prefs: Prefs; private set
    lateinit var store: Store; private set
    lateinit var shield: Shield; private set
    lateinit var server: Server; private set
    lateinit var vault: Vault; private set
    lateinit var updater: Updater; private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        L.init(this, prefs.language)
        store = Store(this)
        shield = Shield(this)
        server = Server(this)
        vault = Vault(this)
        updater = Updater(this)
    }
}

val Context.app: App get() = applicationContext as App

/** Traductions : le texte français sert de clé ; l'anglais vient de assets/i18n-en.json. */
object L {
    @Volatile var en = false
    private var dict: Map<String, String> = emptyMap()
    fun init(ctx: Context, lang: String) {
        en = lang == "en" || (lang == "auto" && Locale.getDefault().language != "fr")
        if (dict.isEmpty()) dict = try {
            val o = JSONObject(ctx.assets.open("i18n-en.json").bufferedReader().use { it.readText() })
            o.keys().asSequence().associateWith { o.getString(it) }
        } catch (_: Exception) { emptyMap() }
    }
    fun t(fr: String): String = if (en) dict[fr] ?: fr else fr
}
fun t(fr: String): String = L.t(fr)

class Prefs(ctx: Context) {
    val sp: SharedPreferences = ctx.getSharedPreferences("dgb", Context.MODE_PRIVATE)
    private fun str(k: String, d: String) = sp.getString(k, d) ?: d
    private fun put(block: SharedPreferences.Editor.() -> Unit) = sp.edit().apply(block).apply()

    var engine: String get() = str("engine", "google"); set(v) = put { putString("engine", v) }
    var language: String get() = str("language", "auto"); set(v) = put { putString("language", v) }
    var shield: Boolean get() = sp.getBoolean("shield", true); set(v) = put { putBoolean("shield", v) }
    var phishing: Boolean get() = sp.getBoolean("phishing", true); set(v) = put { putBoolean("phishing", v) }
    var httpsFirst: Boolean get() = sp.getBoolean("httpsFirst", true); set(v) = put { putBoolean("httpsFirst", v) }
    /** -1 : pas encore demandé, 0 : refusé, 1 : accepté. */
    var telemetry: Int get() = sp.getInt("telemetry", -1); set(v) = put { putInt("telemetry", v) }
    val telemetryId: String get() {
        val cur = str("telemetryId", "")
        if (Regex("^[a-f0-9]{32}$").matches(cur)) return cur
        val id = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        put { putString("telemetryId", id) }
        return id
    }
    var lockdown: String get() = str("lockdown", ""); set(v) = put { putString("lockdown", v) }
    var lockRev: Long get() = sp.getLong("lockRev", 0); set(v) = put { putLong("lockRev", v) }
    var dismissed: Set<String> get() = sp.getStringSet("dismissed", emptySet()) ?: emptySet(); set(v) = put { putStringSet("dismissed", v.toList().takeLast(50).toSet()) }
    var tabs: String get() = str("tabs", ""); set(v) = put { putString("tabs", v) }
    var notifAsked: Boolean get() = sp.getBoolean("notifAsked", false); set(v) = put { putBoolean("notifAsked", v) }
    var skippedUpdate: String get() = str("skippedUpdate", ""); set(v) = put { putString("skippedUpdate", v) }
}

data class Entry(val url: String, val title: String, val at: Long)

/** Favoris, historique et réglages par site (fichiers JSON privés de l'application). */
class Store(private val ctx: Context) {
    private val bookmarksFile = File(ctx.filesDir, "bookmarks.json")
    private val historyFile = File(ctx.filesDir, "history.json")
    val bookmarks = ArrayList<Entry>()
    val history = ArrayList<Entry>()
    private val sp = ctx.getSharedPreferences("dgb-sites", Context.MODE_PRIVATE)

    init { read(bookmarksFile, bookmarks); read(historyFile, history) }

    private fun read(f: File, into: MutableList<Entry>) {
        try {
            val a = JSONArray(f.readText())
            for (i in 0 until a.length()) { val o = a.getJSONObject(i); into.add(Entry(o.optString("url"), o.optString("title"), o.optLong("at"))) }
        } catch (_: Exception) {}
    }
    private fun write(f: File, list: List<Entry>) {
        val a = JSONArray(); for (e in list) a.put(JSONObject().put("url", e.url).put("title", e.title).put("at", e.at))
        val tmp = File(f.path + ".tmp"); tmp.writeText(a.toString()); tmp.renameTo(f)
    }

    fun isBookmarked(url: String) = bookmarks.any { it.url == url }
    fun toggleBookmark(url: String, title: String): Boolean {
        val had = bookmarks.removeAll { it.url == url }
        if (!had) bookmarks.add(0, Entry(url, title.ifBlank { UrlTools.display(url) }.take(120), System.currentTimeMillis()))
        write(bookmarksFile, bookmarks); return !had
    }
    fun removeBookmark(e: Entry) { bookmarks.remove(e); write(bookmarksFile, bookmarks) }
    fun addBookmarks(list: List<Entry>) { for (e in list) if (!isBookmarked(e.url)) bookmarks.add(e); write(bookmarksFile, bookmarks) }

    fun visit(url: String, title: String) {
        if (!UrlTools.isWeb(url)) return
        val first = history.firstOrNull()
        if (first != null && first.url == url) history[0] = Entry(url, title.ifBlank { first.title }, System.currentTimeMillis())
        else history.add(0, Entry(url, title.take(120), System.currentTimeMillis()))
        while (history.size > 3000) history.removeAt(history.size - 1)
        write(historyFile, history)
    }
    fun updateTitle(url: String, title: String) {
        val first = history.firstOrNull() ?: return
        if (first.url == url && title.isNotBlank() && first.title != title) { history[0] = first.copy(title = title.take(120)); write(historyFile, history) }
    }
    fun clearHistory() { history.clear(); write(historyFile, history) }
    fun removeHistory(e: Entry) { history.remove(e); write(historyFile, history) }

    /** Sites les plus visités (page d'accueil). */
    fun topSites(n: Int): List<Entry> {
        val seen = LinkedHashMap<String, Pair<Entry, Int>>()
        for (e in history.take(1500)) { val h = UrlTools.host(e.url); if (h.isEmpty()) continue; val p = seen[h]; seen[h] = if (p == null) e to 1 else p.first to p.second + 1 }
        return seen.values.sortedByDescending { it.second }.take(n).map { (e, _) -> Entry(UrlTools.origin(e.url) + "/", UrlTools.display(UrlTools.origin(e.url)), e.at) }
    }

    // ---- Autorisations par site : camera, microphone, geolocation, insecure → "ask" | "allow" | "block"
    fun sitePermission(origin: String, key: String): String {
        val d = if (key == "camera" || key == "microphone") "ask" else "block"
        if (origin.isEmpty()) return d
        return try { JSONObject(sp.getString(origin, "{}") ?: "{}").optString(key, d) } catch (_: Exception) { d }
    }
    fun setSitePermission(origin: String, key: String, mode: String) {
        if (origin.isEmpty()) return
        val o = try { JSONObject(sp.getString(origin, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        o.put(key, mode); sp.edit().putString(origin, o.toString()).apply()
    }
    fun resetSite(origin: String) { sp.edit().remove(origin).apply() }
    fun customSites(): List<String> = sp.all.keys.filter { it.startsWith("http") }.sorted()

    // ---- DevGitShield désactivé pour certains sites
    private val shieldOff = ctx.getSharedPreferences("dgb-shield-off", Context.MODE_PRIVATE)
    fun shieldAllowed(host: String) = host.isNotEmpty() && shieldOff.contains(host)
    fun setShieldAllowed(host: String, allowed: Boolean) { if (allowed) shieldOff.edit().putBoolean(host, true).apply() else shieldOff.edit().remove(host).apply() }
}
