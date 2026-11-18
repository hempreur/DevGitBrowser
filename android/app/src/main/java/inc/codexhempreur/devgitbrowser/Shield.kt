package inc.codexhempreur.devgitbrowser

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/** Requêtes HTTPS simples (listes, GitHub). */
object Net {
    fun get(url: String, maxBytes: Int = 8_000_000, timeoutMs: Int = 20_000, headers: Map<String, String> = emptyMap()): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs; c.instanceFollowRedirects = true
        c.setRequestProperty("User-Agent", "DevGitBrowser-Android")
        for ((k, v) in headers) c.setRequestProperty(k, v)
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("HTTP ${c.responseCode}")
            val bytes = c.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(16384)
                while (true) { val n = input.read(buf); if (n < 0) break; out.write(buf, 0, n); if (out.size() > maxBytes) throw IllegalStateException("trop grand") }
                out.toByteArray()
            }
            return String(bytes, Charsets.UTF_8)
        } finally { c.disconnect() }
    }
}

/**
 * DevGitShield (publicités et traqueurs) et protection anti-hameçonnage.
 * Mêmes listes publiques que sur PC, téléchargées sur le téléphone et mises à jour chaque jour.
 * Rien n'est envoyé à un tiers : la vérification est locale.
 */
class Shield(private val ctx: Context) {
    private class Source(val id: String, val urls: List<String>)
    private val ghostery = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets"
    private val adSources = listOf(
        Source("easylist", listOf("https://easylist.to/easylist/easylist.txt", "$ghostery/easylist/easylist.txt")),
        Source("easyprivacy", listOf("https://easylist.to/easylist/easyprivacy.txt", "$ghostery/easylist/easyprivacy.txt")),
        Source("peter-lowe", listOf("$ghostery/peter-lowe/serverlist.txt")),
        Source("easylist-france", listOf("https://easylist-downloads.adblockplus.org/liste_fr.txt"))
    )
    private val phishSources = listOf(
        Source("phishing", listOf("https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt", "https://curbengh.github.io/phishing-filter/phishing-filter-hosts.txt")),
        Source("urlhaus", listOf("https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt", "https://curbengh.github.io/urlhaus-filter/urlhaus-filter-hosts.txt"))
    )
    private val dir = File(ctx.filesDir, "shield").apply { mkdirs() }
    @Volatile private var ads = HostSet()
    @Volatile private var danger = HostSet()
    val totalBlocked = AtomicInteger(0)
    @Volatile var ready = false; private set
    val adRules get() = ads.size
    val dangerRules get() = danger.size

    fun start() {
        Thread({
            ads = loadOffline().also { build(adSources, it) }
            danger = HostSet().also { build(phishSources, it) }
            ready = true
            refresh(force = false)
        }, "dgb-shield").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }.start()
    }

    private fun loadOffline(): HostSet = try {
        FilterParser.parse(ctx.assets.open("shield-offline.txt").bufferedReader().use { it.readText() })
    } catch (_: Exception) { HostSet() }

    private fun build(sources: List<Source>, into: HostSet) {
        for (s in sources) { val f = File(dir, s.id + ".txt"); if (f.exists()) try { FilterParser.parse(f.readText(), into) } catch (_: Exception) {} }
    }

    /** Télécharge les listes de plus d'un jour (une source injoignable n'efface jamais les autres). */
    fun refresh(force: Boolean) {
        var changed = false
        for (s in adSources + phishSources) {
            val f = File(dir, s.id + ".txt")
            if (!force && f.exists() && System.currentTimeMillis() - f.lastModified() < 24 * 3600_000L) continue
            for (u in s.urls) {
                try {
                    val text = Net.get(u, maxBytes = 25_000_000, timeoutMs = 30_000)
                    if (text.length < 200 || text.trimStart().startsWith("<")) continue
                    val tmp = File(dir, s.id + ".tmp"); tmp.writeText(text); tmp.renameTo(f); changed = true; break
                } catch (_: Exception) {}
            }
        }
        if (changed) {
            ads = loadOffline().also { build(adSources, it) }
            danger = HostSet().also { build(phishSources, it) }
        }
    }

    fun blocks(requestHost: String, pageHost: String) = ads.blocks(requestHost, pageHost)
    fun dangerous(host: String) = danger.match(host) != null
}
