package inc.codexhempreur.devgitbrowser

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import org.json.JSONArray
import java.security.MessageDigest
import java.security.SecureRandom

// ============================================================================ Mode DGBx (caché, réservé aux adultes)
// Même fonctionnement que sur PC : commande %SxOnSite% dans la barre d'adresse, confirmation de majorité,
// code d'accès facultatif (4 à 8 chiffres, 5 essais puis une minute d'attente), sites ouverts dans des
// onglets privés (rien dans l'historique), tout se ferme avec « Quitter DGBx ».

data class XSite(val name: String, val url: String, val price: String, val desc: String, val tags: List<String>)
data class XCategory(val id: String, val title: String, val sites: List<XSite>)

object XCatalog {
    val COMMAND = Regex("^\\s*%SxOnSite%\\s*$", RegexOption.IGNORE_CASE)
    private val CAT = Regex("\\{id:\\s*'([^']*)',\\s*title:\\s*'([^']*)',\\s*sites:\\s*\\[")
    private val SITE = Regex("\\{name:\\s*'([^']*)',\\s*url:\\s*'(https://[^']*)',\\s*price:\\s*'([^']*)',\\s*desc:\\s*'([^']*)',\\s*tags:\\s*\\[([^\\]]*)\\]\\}")
    private val TAG = Regex("'([^']*)'")

    /** Lit ui/x-catalog.js du navigateur PC (copié tel quel dans l'APK) : une seule liste pour PC et Android. */
    fun parse(js: String): List<XCategory> {
        val cats = CAT.findAll(js).toList()
        return cats.mapIndexed { i, m ->
            val end = if (i + 1 < cats.size) cats[i + 1].range.first else js.length
            val chunk = js.substring(m.range.last, end)
            XCategory(m.groupValues[1], m.groupValues[2], SITE.findAll(chunk).map { s ->
                XSite(s.groupValues[1], s.groupValues[2], s.groupValues[3], s.groupValues[4], TAG.findAll(s.groupValues[5]).map { it.groupValues[1] }.toList())
            }.toList())
        }.filter { it.sites.isNotEmpty() }
    }

    fun isValidCode(code: String) = Regex("^\\d{4,8}$").matches(code)
}

/** Réglages DGBx : confirmation de majorité, code d'accès (scrypt salé, jamais en clair), favoris et « Reprendre ». */
class XPrefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("dgb-x", Context.MODE_PRIVATE)
    var age: Boolean get() = sp.getBoolean("age", false); set(v) { sp.edit().putBoolean("age", v).apply() }
    val hasCode get() = !sp.getString("code", "").isNullOrEmpty()
    private var failures = 0
    private var blockedUntil = 0L

    fun setCode(code: String) {
        if (code.isEmpty()) { sp.edit().remove("code").apply(); return }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        sp.edit().putString("code", b64(salt) + "$" + b64(derive(code, salt))).apply()
    }

    /** null si le code est bon, sinon le message d'erreur. */
    fun check(code: String): String? {
        if (System.currentTimeMillis() < blockedUntil) return t("Trop d’essais. Réessaie dans une minute.")
        val stored = sp.getString("code", "") ?: ""
        if (stored.isEmpty()) return null
        val parts = stored.split("$")
        val ok = parts.size == 2 && try { MessageDigest.isEqual(derive(code, Base64.decode(parts[0], Base64.NO_WRAP)), Base64.decode(parts[1], Base64.NO_WRAP)) } catch (_: Exception) { false }
        if (ok) { failures = 0; return null }
        if (++failures >= 5) { failures = 0; blockedUntil = System.currentTimeMillis() + 60_000 }
        return t("Code d’accès incorrect.")
    }

    private fun derive(code: String, salt: ByteArray) = Scrypt.derive(code.toByteArray(), salt, 1 shl 14, 8, 1, 32)
    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)

    private fun list(k: String): List<String> = try { JSONArray(sp.getString(k, "[]")).let { a -> (0 until a.length()).map { a.getString(it) } } } catch (_: Exception) { emptyList() }
    private fun save(k: String, v: List<String>) { sp.edit().putString(k, JSONArray(v).toString()).apply() }
    val favorites get() = list("fav")
    val recent get() = list("recent")
    fun toggleFavorite(url: String) { val f = favorites; save("fav", if (url in f) f - url else listOf(url) + f) }
    fun touch(url: String) { save("recent", (listOf(url) + recent.filter { it != url }).take(12)) }
}

// ---------------------------------------------------------------------------- Interface Android
private const val X_BG = 0xFF0B0410.toInt()
private const val X_SURFACE = 0xFF1A0A22.toInt()
private const val X_LINE = 0xFF4A1650.toInt()
const val X_ACCENT = 0xFFFF2E93.toInt()
const val X_BAR = 0xFF2A0A2E.toInt()

private fun MainActivity.codeField(hint: String) = EditText(this).apply {
    this.hint = hint; setTextColor(C.TEXT); setHintTextColor(C.MUTED); textSize = 16f; setSingleLine()
    inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
    filters = arrayOf(android.text.InputFilter.LengthFilter(8))
    background = rounded(C.SURFACE, dp(10), dp(1), C.LINE); setPadding(dp(12), dp(10), dp(12), dp(10))
}

private fun MainActivity.box(vararg views: View) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0)
    for (v in views) addView(v, lp().margins(b = dp(10)))
}

/** Commande %SxOnSite% : ouvre (porte d'entrée) ou ferme le mode DGBx. */
fun MainActivity.toggleXmode() {
    if (!BuildConfig.XMODE) return
    if (xmode) { exitXmode(); return }
    val x = app.xprefs
    when {
        !x.age -> {
            val age = CheckBox(this).apply { text = t("J’ai 18 ans ou plus"); setTextColor(C.TEXT); buttonTintList = android.content.res.ColorStateList.valueOf(X_ACCENT) }
            val code = codeField(t("Code d’accès (facultatif, 4 à 8 chiffres)"))
            AlertDialog.Builder(this).setTitle("🔞 DGBx")
                .setView(box(text(t("Ce mode regroupe des plateformes adultes légales et connues. Il est réservé aux personnes majeures. DevGitBrowser n’héberge aucun contenu."), 14f, C.MUTED), age, code,
                    text(t("Le code protège l’accès si quelqu’un d’autre utilise ton téléphone."), 12.5f, C.MUTED)))
                .setNegativeButton(t("Annuler"), null)
                .setPositiveButton(t("Entrer")) { _, _ ->
                    val c = code.text.toString().trim()
                    when {
                        !age.isChecked -> toast(t("Confirmation de majorité requise."))
                        c.isNotEmpty() && !XCatalog.isValidCode(c) -> toast(t("Le code doit contenir 4 à 8 chiffres."))
                        else -> { x.age = true; x.setCode(c); enterXmode() }
                    }
                }.show()
        }
        x.hasCode -> {
            val code = codeField(t("Code d’accès"))
            val d = AlertDialog.Builder(this).setTitle("🔞 DGBx").setView(box(code))
                .setNegativeButton(t("Annuler"), null)
                .setPositiveButton(t("Entrer")) { _, _ -> val err = x.check(code.text.toString().trim()); if (err != null) toast(err) else enterXmode() }.create()
            code.setOnEditorActionListener { _, _, _ -> d.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); true }
            d.show(); code.requestFocus()
        }
        else -> enterXmode()
    }
}

fun MainActivity.changeXCode() {
    val x = app.xprefs
    val now = codeField(t("Code actuel"))
    val next = codeField(t("Nouveau code (vide = aucun code)"))
    val views = if (x.hasCode) arrayOf<View>(now, next) else arrayOf<View>(next)
    AlertDialog.Builder(this).setTitle(t("Code d’accès DGBx")).setView(box(*views))
        .setNegativeButton(t("Annuler"), null)
        .setPositiveButton(t("Enregistrer")) { _, _ ->
            val n = next.text.toString().trim()
            if (n.isNotEmpty() && !XCatalog.isValidCode(n)) { toast(t("Le code doit contenir 4 à 8 chiffres.")); return@setPositiveButton }
            if (x.hasCode) x.check(now.text.toString().trim())?.let { err -> toast(err); return@setPositiveButton }
            x.setCode(n); toast(if (n.isEmpty()) t("Code d’accès supprimé.") else t("Code d’accès modifié."))
        }.show()
}

/** Accueil DGBx (remplace la page d'accueil tant que le mode est ouvert). */
fun MainActivity.buildXHome(open: (XSite) -> Unit, query: String = ""): View {
    val x = app.xprefs
    val catalog = xCatalog
    val all = catalog.flatMap { it.sites }
    val scroll = ScrollView(this).apply { isFillViewport = true; setBackgroundColor(X_BG) }
    val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(20), dp(14), dp(28)) }
    scroll.addView(col)

    val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    head.addView(text("DGBx", 26f, X_ACCENT, bold = true))
    head.addView(text("18+", 11f, Color.WHITE, bold = true).apply { background = rounded(X_ACCENT, dp(8)); setPadding(dp(6), dp(2), dp(6), dp(2)) }, lp(ViewGroup.LayoutParams.WRAP_CONTENT).margins(l = dp(8)))
    head.addView(View(this), lp(0, 1, 1f))
    head.addView(text(t("Quitter"), 13f, Color.WHITE, bold = true).apply { background = rounded(X_SURFACE, dp(16), dp(1), X_LINE); setPadding(dp(14), dp(7), dp(14), dp(7)); ripple(dp(16), X_SURFACE); setOnClickListener { exitXmode() } })
    col.addView(head, lp())
    col.addView(text(t("Navigation privée : rien n’est gardé dans l’historique. Les plateformes appliquent leurs propres contrôles d’âge."), 12.5f, C.MUTED), lp().margins(t = dp(6), b = dp(12)))

    val search = EditText(this).apply {
        setSingleLine(); hint = t("Rechercher une plateforme"); setText(query); setTextColor(C.TEXT); setHintTextColor(C.MUTED); textSize = 15f
        background = rounded(X_SURFACE, dp(16), dp(1), X_LINE); setPadding(dp(16), dp(12), dp(16), dp(12))
        imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
        setOnEditorActionListener { v, _, _ -> refreshXHome(v.text.toString()); true }
    }
    col.addView(search, lp().margins(b = dp(10)))
    val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    actions.addView(button("🎲 " + t("Au hasard"), primary = true) { all.filter { it.price != "Payant" }.randomOrNull()?.let(open) }.apply { background = rounded(X_ACCENT, dp(10)) }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(5)))
    actions.addView(button("🔑 " + t("Code d’accès")) { changeXCode() }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = dp(5)))
    col.addView(actions, lp().margins(b = dp(6)))

    fun card(site: XSite, index: Int): View {
        val c = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; background = rounded(X_SURFACE, dp(14), dp(1), X_LINE); setPadding(dp(10), dp(10), dp(10), dp(10)); ripple(dp(14), X_SURFACE) }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val hue = floatArrayOf(((index * 47) % 360).toFloat(), 0.75f, 0.85f)
        top.addView(text(site.name.replace(Regex("[^A-Za-z0-9&]"), "").take(2).uppercase(), 16f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; background = rounded(Color.HSVToColor(hue), dp(10)) }, LinearLayout.LayoutParams(dp(40), dp(40)))
        top.addView(View(this), lp(0, 1, 1f))
        val fav = site.url in x.favorites
        top.addView(text(if (fav) "♥" else "♡", 20f, if (fav) X_ACCENT else C.MUTED).apply {
            gravity = Gravity.CENTER; ripple(dp(16)); contentDescription = if (fav) t("Retirer de ma liste") else t("Ajouter à ma liste")
            setOnClickListener { x.toggleFavorite(site.url); refreshXHome(search.text.toString()) }
        }, LinearLayout.LayoutParams(dp(36), dp(36)))
        c.addView(top, lp())
        c.addView(text(site.name, 15f, bold = true, lines = 1), lp().margins(t = dp(8)))
        c.addView(text(site.desc, 12f, C.MUTED, lines = 3), lp(h = dp(48)))
        val priceColor = when (site.price) { "Gratuit" -> C.GOOD; "Payant" -> C.WARN; else -> 0xFF7FD3FF.toInt() }
        c.addView(text(t(site.price), 11f, priceColor, bold = true), lp().margins(t = dp(4)))
        c.setOnClickListener { open(site) }
        return c
    }
    fun row(title: String, sites: List<XSite>, offset: Int) {
        if (sites.isEmpty()) return
        col.addView(text(title, 15f, Color.WHITE, bold = true), lp().margins(t = dp(14), b = dp(8)))
        val track = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sites.forEachIndexed { i, s -> track.addView(card(s, i + offset), LinearLayout.LayoutParams(dp(158), ViewGroup.LayoutParams.WRAP_CONTENT).margins(r = dp(10))) }
        col.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(track) }, lp())
    }
    val q = query.trim().lowercase()
    if (q.isNotEmpty()) {
        val found = all.filter { (it.name + " " + it.desc + " " + it.tags.joinToString(" ")).lowercase().contains(q) }
        if (found.isEmpty()) col.addView(text(t("Aucune plateforme ne correspond."), 14f, C.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(30), 0, 0) }, lp())
        else row(t("Résultats pour « %s »").format(query.trim()), found, 0)
    } else {
        row("♥ " + t("Ma liste"), x.favorites.mapNotNull { u -> all.find { it.url == u } }, 3)
        row(t("Reprendre"), x.recent.mapNotNull { u -> all.find { it.url == u } }, 7)
        catalog.forEachIndexed { i, c -> row(t(c.title), c.sites, i * 5) }
    }
    return scroll
}
