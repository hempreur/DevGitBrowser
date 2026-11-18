package inc.codexhempreur.devgitbrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test fun addressOrSearch() {
        assertEquals("https://example.com", UrlTools.searchOrAddress("example.com", "google"))
        assertEquals("https://www.babelvisio.com/room/abc", UrlTools.searchOrAddress("www.babelvisio.com/room/abc", "google"))
        assertEquals("http://localhost:3000", UrlTools.searchOrAddress("localhost:3000", "google"))
        assertEquals("http://192.168.1.1", UrlTools.searchOrAddress("192.168.1.1", "google"))
        assertTrue(UrlTools.searchOrAddress("météo paris", "google")!!.startsWith("https://www.google.com/search?q=m%C3%A9t%C3%A9o+paris"))
        assertTrue(UrlTools.searchOrAddress("chat gpt", "duckduckgo")!!.startsWith("https://duckduckgo.com/?q="))
        assertTrue(UrlTools.searchOrAddress("javascript:alert(1)", "google")!!.startsWith("https://www.google.com/search"))
        assertNull(UrlTools.searchOrAddress("   ", "google"))
    }

    @Test fun hostsAndOrigins() {
        assertEquals("www.example.com", UrlTools.host("https://user:pw@WWW.Example.com:8443/x?y#z"))
        assertEquals("https://example.com:8443", UrlTools.origin("https://example.com:8443/x"))
        assertEquals("https://example.com", UrlTools.origin("https://example.com:443/x"))
        assertEquals("", UrlTools.origin("file:///etc/passwd"))
        assertEquals("https://example.com/x", UrlTools.httpsUpgrade("http://example.com/x"))
        assertNull(UrlTools.httpsUpgrade("http://192.168.1.10/"))
        assertNull(UrlTools.httpsUpgrade("http://localhost:8080/"))
        assertNull(UrlTools.httpsUpgrade("https://example.com/"))
    }

    @Test fun versions() {
        assertTrue(Versions.newer("2.1.0", "2.0.9"))
        assertTrue(Versions.newer("2.10.0", "2.9.0"))
        assertFalse(Versions.newer("2.0.1", "2.0.1"))
        assertFalse(Versions.newer("1.18.6", "2.0.0"))
        assertFalse(Versions.newer("n'importe quoi", "2.0.0"))
    }

    @Test fun shieldRules() {
        val set = FilterParser.parse("""
            ! commentaire
            [Adblock Plus 2.0]
            ||doubleclick.net^
            ||tracker.example^${'$'}third-party
            ||ads.example.com^${'$'}script
            ||cdn.example.org^${'$'}domain=site.fr
            @@||good.doubleclick.net^
            example.com##.ad
            0.0.0.0 malware.test
            127.0.0.1 localhost
            /banner/ads/
        """.trimIndent())
        assertTrue(set.blocks("ad.doubleclick.net", "news.fr"))
        assertTrue(set.blocks("tracker.example", "news.fr"))
        assertFalse("règle ciblée (type de ressource) ignorée", set.blocks("ads.example.com", "news.fr"))
        assertFalse("règle limitée à un site ignorée", set.blocks("cdn.example.org", "news.fr"))
        assertFalse("exception @@", set.blocks("good.doubleclick.net", "news.fr"))
        assertFalse("jamais sur le site lui-même", set.blocks("doubleclick.net", "www.doubleclick.net"))
        assertTrue(set.blocks("x.malware.test", "news.fr"))
        assertFalse(set.blocks("localhost", "news.fr"))
        assertFalse(set.blocks("example.com", "news.fr"))
        assertEquals(3, set.size)
    }

    @Test fun csvImport() {
        val chrome = "name,url,username,password,note\n" +
            "Exemple,https://exemple.fr/login,alice,\"p,a\"\"ss\",\n" +
            "Sans mdp,https://vide.fr,bob,,\n" +
            "Local,file:///x,carl,secret,\n" +
            "Exemple bis,https://exemple.fr/autre,alice,nouveau,\n"
        val list = PasswordImport.fromCsv("﻿" + chrome)
        assertEquals(1, list.size)
        assertEquals(Credential("https://exemple.fr", "alice", "nouveau"), list[0])
        val firefox = "\"url\",\"username\",\"password\",\"httpRealm\",\"formActionOrigin\",\"guid\"\r\n\"https://site.com\",\"me\",\"pw\",,\"\",\"{1}\"\r\n"
        assertEquals(listOf(Credential("https://site.com", "me", "pw")), PasswordImport.fromCsv(firefox))
        val bitwarden = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,X,,,0,https://bw.test/,u,p,\n"
        assertEquals(listOf(Credential("https://bw.test", "u", "p")), PasswordImport.fromCsv(bitwarden))
        assertTrue(PasswordImport.fromCsv("a,b\n1,2").isEmpty())
    }
}

class ScryptTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    @Test fun rfc7914() {
        assertEquals("fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
            hex(Scrypt.derive("password".toByteArray(), "NaCl".toByteArray(), 1024, 8, 16, 64)))
    }
    @Test fun sameAsDesktop() {
        // Empreintes produites par lib/admin.js (Node) : la clé admin du PC fonctionne aussi sur Android.
        assertTrue(Scrypt.verify(AdminKeys.normalizeKey("dgb abcd efgh jklm npqr"), "scrypt\$pgOT7MVI8xPqRMABE6Hzfw==\$NBPp60tlr88YJxB+kTjvGwOm9RJM5vfqzjhwyWvvuWk="))
        assertFalse(Scrypt.verify("DGB-ABCD-EFGH-JKLM-NPQS", "scrypt\$pgOT7MVI8xPqRMABE6Hzfw==\$NBPp60tlr88YJxB+kTjvGwOm9RJM5vfqzjhwyWvvuWk="))
        assertTrue(Scrypt.verify(AdminKeys.recoveryPhrase(listOf("Soleil", "lune ", " ETOILE")), "scrypt\$X1GKkEVxtFHhDy5WXoetTA==\$fJ65459zSChu98+G75h5gsg32HhybgMKSY8c6aqU/Fo="))
    }
}

class DgbxTest {
    @Test fun catalogFromDesktop() {
        val js = java.io.File("../../ui/x-catalog.js").readText()
        val cats = XCatalog.parse(js)
        val expected = Regex("\\burl: '").findAll(js).count()
        assertEquals(6, cats.size)
        assertEquals(expected, cats.sumOf { it.sites.size })
        assertTrue(cats.flatMap { it.sites }.all { it.url.startsWith("https://") && it.name.isNotBlank() && it.price in setOf("Gratuit", "Freemium", "Payant") })
    }

    @Test fun commandsAndCodes() {
        assertTrue(XCatalog.COMMAND.matches("%SxOnSite%")); assertTrue(XCatalog.COMMAND.matches("  %sxonsite% "))
        assertFalse(XCatalog.COMMAND.matches("%SxOnSite% x")); assertTrue(AdminKeys.COMMAND.matches("%AdminDBG%"))
        assertTrue(XCatalog.isValidCode("1234")); assertTrue(XCatalog.isValidCode("12345678"))
        assertFalse(XCatalog.isValidCode("123")); assertFalse(XCatalog.isValidCode("12a4")); assertFalse(XCatalog.isValidCode("123456789"))
    }
}

class AndroidReleasesTest {
    private fun rel(tag: String, apk: String?, pre: Boolean = false) = org.json.JSONObject().put("tag_name", tag).put("prerelease", pre).put("html_url", "https://github.com/x")
        .put("assets", org.json.JSONArray().apply { if (apk != null) put(org.json.JSONObject().put("name", apk).put("browser_download_url", "https://github.com/$apk").put("size", 10)) })

    @Test fun picksNewestAndroidRelease() {
        val list = org.json.JSONArray().put(rel("v2.2.0", "DevGitBrowser-Android-2.2.0.apk")).put(rel("android-v1.0.2", "DevGitBrowser-Android-1.0.2.apk"))
            .put(rel("android-v1.0.4", null)).put(rel("android-v1.1.0", "DevGitBrowser-Android-1.1.0.apk", pre = true)).put(rel("android-v1.0.3", "DevGitBrowser-Android-1.0.3.apk"))
        assertEquals("1.0.3", AndroidReleases.pick(list, "1.0.1")?.version)
        assertNull(AndroidReleases.pick(list, "1.0.3"))
    }
}
