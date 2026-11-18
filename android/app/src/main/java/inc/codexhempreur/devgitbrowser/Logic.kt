package inc.codexhempreur.devgitbrowser

import java.net.URLEncoder
import java.util.Locale

// Logique sans dépendance à Android : testée par les tests unitaires (app/src/test).

object UrlTools {
    val engines: LinkedHashMap<String, Pair<String, String>> = linkedMapOf(
        "google" to ("Google" to "https://www.google.com/search?q="),
        "duckduckgo" to ("DuckDuckGo" to "https://duckduckgo.com/?q="),
        "bing" to ("Bing" to "https://www.bing.com/search?q="),
        "qwant" to ("Qwant" to "https://www.qwant.com/?q="),
        "ecosia" to ("Ecosia" to "https://www.ecosia.org/search?q="),
        "brave" to ("Brave Search" to "https://search.brave.com/search?q=")
    )
    private val hostRe = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?(\\[[^\\]]+]|[^/?#:]+)(?::(\\d{1,5}))?")
    private val addressRe = Regex("^(localhost|\\[[0-9a-fA-F:]+]|[\\p{L}\\p{N}-]+(\\.[\\p{L}\\p{N}-]+)+|\\d{1,3}(\\.\\d{1,3}){3})(:\\d{1,5})?([/?#].*)?$")
    private val ipRe = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    fun isWeb(url: String?): Boolean = url != null && (url.startsWith("http://", true) || url.startsWith("https://", true))

    fun search(query: String, engine: String): String =
        (engines[engine] ?: engines.getValue("google")).second + URLEncoder.encode(query, "UTF-8")

    /** Texte tapé dans la barre d'adresse : adresse (https par défaut) ou recherche. */
    fun searchOrAddress(input: String, engine: String): String? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (isWeb(text) && !text.contains(' ')) return text
        if (!text.contains(' ') && addressRe.matches(text)) {
            val tld = host("https://$text").substringAfterLast('.', "")
            // « mot.mot » sans extension plausible (ex. « node.js ») reste une recherche, sauf adresse IP ou port.
            if (ipRe.matches(host("https://$text")) || text.startsWith("localhost") || text.contains(':') || text.contains('/') || tld.length in 2..24 && tld.all { it.isLetter() }) {
                return (if (text.startsWith("localhost") || ipRe.matches(host("https://$text"))) "http://" else "https://") + text
            }
        }
        return search(text, engine)
    }

    fun host(url: String?): String {
        val m = hostRe.find(url ?: return "") ?: return ""
        return m.groupValues[1].lowercase(Locale.ROOT).trimEnd('.')
    }

    /** Origine « https://exemple.fr[:port] » ; vide si ce n'est pas une adresse web. */
    fun origin(url: String?): String {
        if (!isWeb(url)) return ""
        val m = hostRe.find(url!!) ?: return ""
        val scheme = url.substringBefore("://").lowercase(Locale.ROOT)
        val port = m.groupValues[2]
        val default = (scheme == "https" && port == "443") || (scheme == "http" && port == "80")
        return "$scheme://${m.groupValues[1].lowercase(Locale.ROOT)}" + if (port.isNotEmpty() && !default) ":$port" else ""
    }

    /** HTTPS prioritaire : adresse http publique → https. Jamais pour une adresse locale ou une IP. */
    fun httpsUpgrade(url: String): String? {
        if (!url.startsWith("http://", true)) return null
        val h = host(url)
        if (h.isEmpty() || h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || ipRe.matches(h) || h.startsWith("[")) return null
        return "https://" + url.substring(7)
    }

    fun display(url: String): String = url.removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/')
}

object Versions {
    fun parse(v: String): List<Int>? {
        val m = Regex("^v?(\\d{1,4})\\.(\\d{1,4})\\.(\\d{1,4})$").matchEntire(v.trim()) ?: return null
        return m.groupValues.drop(1).map { it.toInt() }
    }
    /** a est-elle plus récente que b ? */
    fun newer(a: String, b: String): Boolean {
        val pa = parse(a) ?: return false
        val pb = parse(b) ?: return true
        for (i in 0..2) { if (pa[i] != pb[i]) return pa[i] > pb[i] }
        return false
    }
}

/** Ensemble de domaines : un domaine bloque aussi ses sous-domaines. Les exceptions (@@) l'emportent. */
class HostSet(val block: HashSet<String> = HashSet(), val allow: HashSet<String> = HashSet()) {
    val size get() = block.size

    /** Domaine bloqué qui correspond à host (ou null). */
    fun match(host: String): String? {
        if (host.isEmpty()) return null
        var h = host
        while (true) { if (allow.contains(h)) return null; val i = h.indexOf('.'); if (i < 0) break; h = h.substring(i + 1) }
        h = host
        while (true) { if (block.contains(h)) return h; val i = h.indexOf('.'); if (i < 0) return null; h = h.substring(i + 1) }
    }

    /** Requête bloquée sur une page ? Jamais quand on visite le site bloqué lui-même (première partie). */
    fun blocks(requestHost: String, pageHost: String): Boolean {
        val d = match(requestHost) ?: return false
        return !(pageHost == d || pageHost.endsWith(".$d"))
    }

    fun addAll(other: HostSet) { block.addAll(other.block); allow.addAll(other.allow) }
}

object FilterParser {
    private val abp = Regex("^\\|\\|([a-z0-9.-]+)\\^(?:\\$(.*))?$")
    private val domainRe = Regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$")

    /**
     * Lit une liste EasyList / uBlock (règles « ||domaine^ ») ou au format hosts.
     * Les règles ciblées (par type de ressource, par site…) et cosmétiques sont ignorées : on ne bloque que des
     * domaines entiers, ce qui ne casse pas les pages.
     */
    fun parse(text: String, into: HostSet = HostSet(), max: Int = 400_000): HostSet {
        for (raw in text.lineSequence()) {
            if (into.block.size >= max) break
            val line = raw.trim()
            if (line.isEmpty() || line[0] == '!' || line[0] == '[' || line[0] == '#') continue
            if (line.contains("##") || line.contains("#@#") || line.contains("#?#") || line.contains("#$#") || line.contains("#%#")) continue
            val exception = line.startsWith("@@")
            val body = (if (exception) line.substring(2) else line).lowercase(Locale.ROOT)
            val m = abp.matchEntire(body)
            if (m != null) {
                if (!optionsOk(m.groupValues[2], exception)) continue
                val d = m.groupValues[1].trim('.')
                if (domainRe.matches(d)) (if (exception) into.allow else into.block).add(d)
                continue
            }
            if (exception) continue
            val parts = body.split(Regex("\\s+"))
            val d = when {
                parts.size >= 2 && (parts[0] == "0.0.0.0" || parts[0] == "127.0.0.1") -> parts[1]
                parts.size == 1 -> parts[0]
                else -> ""
            }.trim('.')
            if (domainRe.matches(d) && d != "localhost" && d != "localhost.localdomain") into.block.add(d)
        }
        return into
    }

    private fun optionsOk(opts: String, exception: Boolean): Boolean {
        if (opts.isEmpty()) return true
        for (o in opts.split(',')) {
            val k = o.trim()
            if (k == "third-party" || k == "3p" || k == "important" || k == "all") continue
            if (exception && (k == "document" || k == "doc")) continue
            return false
        }
        return true
    }
}

/** CSV (RFC 4180) : guillemets, virgules et retours à la ligne dans les champs. */
object Csv {
    fun parse(text: String): List<List<String>> {
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val field = StringBuilder()
        var quoted = false
        var i = 0
        val s = text.removePrefix("﻿")
        while (i < s.length) {
            val c = s[i]
            if (quoted) {
                if (c == '"') { if (i + 1 < s.length && s[i + 1] == '"') { field.append('"'); i++ } else quoted = false }
                else field.append(c)
            } else when (c) {
                '"' -> quoted = true
                ',' -> { row.add(field.toString()); field.setLength(0) }
                '\r' -> {}
                '\n' -> { row.add(field.toString()); field.setLength(0); if (row.any { it.isNotEmpty() }) rows.add(row); row = ArrayList() }
                else -> field.append(c)
            }
            i++
        }
        row.add(field.toString())
        if (row.any { it.isNotEmpty() }) rows.add(row)
        return rows
    }
}

data class Credential(val origin: String, val username: String, val password: String)

object PasswordImport {
    /** Export officiel de Chrome, Edge, Firefox, Brave, Opera ou Bitwarden (CSV). */
    fun fromCsv(text: String): List<Credential> {
        val rows = Csv.parse(text)
        if (rows.isEmpty()) return emptyList()
        val head = rows[0].map { it.trim().lowercase(Locale.ROOT) }
        fun col(vararg names: String) = head.indexOfFirst { it in names }
        val iu = col("url", "origin", "login_uri", "website", "site")
        val iuser = col("username", "login_username", "login", "user", "email")
        val ipass = col("password", "login_password", "pass")
        if (iu < 0 || ipass < 0) return emptyList()
        val out = LinkedHashMap<String, Credential>()
        for (r in rows.drop(1)) {
            val origin = UrlTools.origin(r.getOrNull(iu)?.trim())
            val pass = r.getOrNull(ipass) ?: ""
            if (origin.isEmpty() || pass.isEmpty()) continue
            val user = if (iuser >= 0) r.getOrNull(iuser) ?: "" else ""
            out["$origin\u0000$user"] = Credential(origin, user.take(200), pass.take(500))
            if (out.size >= 5000) break
        }
        return out.values.toList()
    }
}
