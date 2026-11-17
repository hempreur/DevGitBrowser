package inc.codexhempreur.devgitbrowser

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/** Travail réseau hors du fil principal, résultat (ou erreur) rendu sur le fil principal. */
fun <T> MainActivity.async(work: () -> T, done: (T?, String?) -> Unit) {
    Thread {
        val r = try { Result.success(work()) } catch (e: Exception) { Result.failure(e) }
        runOnUiThread { if (!isDestroyed) done(r.getOrNull(), r.exceptionOrNull()?.let { it.message ?: "erreur" }) }
    }.start()
}

private fun MainActivity.field(hint: String, value: String = "", multi: Boolean = false, password: Boolean = false) = EditText(this).apply {
    this.hint = hint; setText(value); setTextColor(C.TEXT); setHintTextColor(C.MUTED); textSize = 15f
    background = rounded(C.SURFACE, dp(10), dp(1), C.LINE); setPadding(dp(12), dp(10), dp(12), dp(10))
    if (multi) { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES; minLines = 3; gravity = Gravity.TOP }
    else { setSingleLine(); if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
}

private fun MainActivity.form(vararg views: android.view.View) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0)
    for (v in views) addView(v, lp().margins(b = dp(8)))
}

// ============================================================================ Succès et parrainage
fun MainActivity.showAchievements() {
    val ach = app.achievements
    val s = screen(t("Succès et parrainage"))
    val (_, icon, names) = ach.rank()
    val next = ach.nextRank()
    s.body.addView(text("$icon ${if (L.en) names.second else names.first}", 22f, bold = true), lp().margins(t = dp(14)))
    s.body.addView(text(t("%d points").format(ach.points) + (next?.let { " · " + t("prochain rang à %d points").format(it.first) } ?: ""), 14f, C.MUTED), lp().margins(b = dp(6)))

    s.section(t("Inviter des amis"))
    val code = app.prefs.refCode
    val link = "https://hempreur.github.io/DevGitBrowser/?ref=$code"
    s.row(t("Ton code : %s").format(code), link, onClick = {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("link", link)); toast(t("Lien copié."))
    })
    s.body.addView(button(t("Partager mon lien d’invitation"), primary = true) {
        val text = t("Je te conseille DevGitBrowser, un navigateur gratuit avec bloqueur de pubs et coffre à mots de passe, sur PC et Android. Installe-le avec mon lien : %s (code %s)").format(link, code)
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), t("Partager")))
        ach.bump("invites")
    }, lp().margins(b = dp(6)))
    val count = s.row(t("Amis parrainés"), t("Chargement…"))
    async({ app.server.referralCount(code) }) { n, _ ->
        ((count.getChildAt(0) as LinearLayout).getChildAt(1) as? TextView)?.text = n?.toString() ?: t("Indisponible pour le moment")
        if (n != null) ach.atLeast("referrals", n.toLong())
    }
    if (app.prefs.referredBy.isEmpty()) s.row(t("J’ai un code de parrainage"), t("Indique le code de l’ami qui t’a invité (une seule fois)."), onClick = {
        val f = field(t("Code (8 caractères)"))
        AlertDialog.Builder(this).setTitle(t("Code de parrainage")).setView(form(f)).setNegativeButton(t("Annuler"), null)
            .setPositiveButton(t("Valider")) { _, _ ->
                val c = f.text.toString().trim().uppercase()
                if (!Regex("^[A-Z2-9]{8}$").matches(c)) { toast(t("Code invalide.")); return@setPositiveButton }
                if (c == code) { toast(t("C’est ton propre code !")); return@setPositiveButton }
                async({ app.server.claimReferral(c) }) { r, err ->
                    when (r) {
                        "ok", "already" -> { app.prefs.referredBy = c; toast(t("Merci ! Ton parrain est enregistré.")); s.close(); showAchievements() }
                        "self" -> toast(t("C’est ton propre code !"))
                        else -> toast(t("Code refusé : %s").format(err ?: r ?: ""))
                    }
                }
            }.show()
    })

    for ((cat, meta) in Achievements.CATEGORIES) {
        val (catIcon, label) = meta
        s.section("$catIcon " + if (L.en) label.second else label.first)
        for (a in Achievements.ALL.filter { it.category == cat }) {
            val done = ach.isUnlocked(a.id)
            val v = minOf(ach.value(a.stat), a.target)
            s.row((if (done) "✅ " else "🔒 ") + a.icon + " " + a.name, a.desc + "\n" + (if (done) t("Débloqué") else "$v / ${a.target}") + " · " + t("%d points").format(a.points))
        }
    }
}

// ============================================================================ Rapport de bug et tchat de support
fun MainActivity.reportBug() {
    if (!app.server.available) { toast(t("Serveur indisponible.")); return }
    val desc = field(t("Décris le problème (ce que tu faisais, ce qui s’est passé)"), multi = true)
    val contact = field(t("Contact (facultatif : e-mail ou Discord)"))
    AlertDialog.Builder(this).setTitle(t("Signaler un bug")).setView(form(text(t("Le rapport part chez le créateur de DevGitBrowser, avec la version de l’appli et du téléphone. Aucun site visité n’est envoyé."), 13f, C.MUTED), desc, contact))
        .setNegativeButton(t("Annuler"), null)
        .setPositiveButton(t("Envoyer")) { _, _ ->
            val text = desc.text.toString().trim()
            if (text.length < 10) { toast(t("Décris un peu plus le problème (10 caractères au moins).")); return@setPositiveButton }
            async({ app.server.sendBug(text.take(4000), contact.text.toString().trim()) }) { id, err ->
                if (id == null) toast(t("Envoi impossible : %s").format(err ?: ""))
                else { app.achievements.bump("bugs"); AlertDialog.Builder(this).setTitle(t("Merci !")).setMessage(t("Ton rapport est envoyé. Si l’équipe le prend en charge, une discussion s’ouvrira ici pour échanger avec toi.")).setPositiveButton("OK", null).show() }
            }
        }.show()
}

/** Discussion de support côté utilisateur (ouverte automatiquement quand l'équipe prend le rapport en charge). */
fun MainActivity.showSupportChat(first: SupportView) {
    chatViews[first.bugId]?.let { it(first); return }
    val s = screen(t("Support DevGitBrowser"))
    val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    s.body.addView(text(t("Signalement :") + " " + first.subject, 13f, C.MUTED).apply { background = rounded(C.SURFACE, dp(10)); setPadding(dp(10), dp(8), dp(10), dp(8)) }, lp().margins(t = dp(8), b = dp(8)))
    s.body.addView(list, lp())
    val input = field(t("Écris ton message…"))
    input.imeOptions = EditorInfo.IME_ACTION_SEND
    val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(C.BAR); setPadding(dp(10), dp(8), dp(10), dp(8)) }
    bar.addView(input, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(8)))
    var current = first
    fun render(v: SupportView) {
        current = v; list.removeAllViews()
        for (m in v.messages) {
            if (m.from == "system") { list.addView(text(t(if (m.text == "open") "L’équipe DevGitBrowser a pris ton signalement en charge." else "La discussion a été terminée."), 12f, C.MUTED).apply { gravity = Gravity.CENTER }, lp().margins(t = dp(6), b = dp(6))); continue }
            val mine = m.from == "user"
            val bubble = text(m.text, 14.5f, C.TEXT).apply { setPadding(dp(12), dp(8), dp(12), dp(8)); background = rounded(if (mine) C.ACCENT else C.SURFACE2, dp(14)); setTextIsSelectable(true) }
            val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = if (mine) Gravity.END else Gravity.START }
            if (!mine) wrap.addView(text(t("Équipe DevGitBrowser"), 11f, C.MUTED))
            wrap.addView(bubble, lp(ViewGroup.LayoutParams.WRAP_CONTENT))
            list.addView(wrap, lp().margins(b = dp(6)))
        }
        input.isEnabled = v.open; input.hint = if (v.open) t("Écris ton message…") else t("Discussion terminée")
        (s.body.parent as? ScrollView)?.post { (s.body.parent as ScrollView).fullScroll(ScrollView.FOCUS_DOWN) }
    }
    fun send() {
        val txt = input.text.toString().trim(); if (txt.isEmpty() || !current.open) return
        input.setText("")
        async({ app.server.supportSend(current.bugId, txt) }) { v, err -> if (v != null) render(v) else toast(t("Envoi impossible : %s").format(err ?: "")) }
    }
    input.setOnEditorActionListener { _, _, _ -> send(); true }
    bar.addView(button(t("Envoyer"), primary = true) { send() })
    s.root.addView(bar, lp())
    chatViews[first.bugId] = { render(it) }
    s.onClose = { chatViews.remove(first.bugId) }
    render(first)
}

// ============================================================================ Panneau admin (commande %AdminDBG%)
fun MainActivity.showAdminLogin() {
    val admin = app.admin
    if (admin.open) { adminTokenThen { showAdmin() }; return }
    val wait = admin.lockedFor()
    if (wait > 0) { toast(t("Trop d’essais. Réessaie dans %d s.").format(wait / 1000 + 1)); return }
    val key = field(t("Clé admin (DGB-XXXX-XXXX-XXXX-XXXX)"), password = true)
    AlertDialog.Builder(this).setTitle(t("Panneau admin")).setView(form(key)).setNegativeButton(t("Annuler"), null)
        .setNeutralButton(t("Mots de sécurité")) { _, _ -> adminWords() }
        .setPositiveButton(t("Ouvrir")) { _, _ ->
            toast(t("Vérification…"))
            async({ admin.unlockWithKey(key.text.toString()) }) { ok, _ -> if (ok == true) adminTokenThen { showAdmin() } else toast(t("Clé admin incorrecte.")) }
        }.show()
}

private fun MainActivity.adminWords() {
    val w = (1..3).map { field(t("Mot %d").format(it)) }
    AlertDialog.Builder(this).setTitle(t("Mots de sécurité")).setView(form(*w.toTypedArray())).setNegativeButton(t("Annuler"), null)
        .setPositiveButton(t("Ouvrir")) { _, _ ->
            async({ app.admin.unlockWithWords(w.map { it.text.toString() }) }) { ok, _ -> if (ok == true) adminTokenThen { showAdmin() } else toast(t("Mots de sécurité incorrects.")) }
        }.show()
}

private fun MainActivity.adminTokenThen(next: () -> Unit) {
    if (app.admin.token() != null) { next(); return }
    val f = field(t("Jeton du serveur"), password = true)
    AlertDialog.Builder(this).setTitle(t("Jeton du serveur")).setMessage(t("Colle le jeton admin affiché à l’installation du serveur. Il est chiffré par la puce de sécurité du téléphone."))
        .setView(form(f)).setNegativeButton(t("Annuler"), null)
        .setPositiveButton(t("Enregistrer")) { _, _ ->
            val tok = f.text.toString().trim()
            async({ app.server.request("GET", "/v1/admin/config", null, 15_000, tok).first }) { code, err ->
                if (code == 200) { app.admin.setToken(tok); next() } else toast(t("Jeton refusé par le serveur (%s).").format(code?.toString() ?: err ?: ""))
            }
        }.show()
}

private fun MainActivity.adminCall(method: String, path: String, body: JSONObject? = null, done: (JSONObject?, String?) -> Unit) {
    val tok = app.admin.token() ?: run { done(null, t("Jeton absent")); return }
    async({
        val (code, text) = app.server.request(method, path, body, 20_000, tok)
        if (code == 401) throw IllegalStateException(t("Jeton refusé"))
        if (code !in 200..299) throw IllegalStateException(try { JSONObject(text).optString("error", "HTTP $code") } catch (_: Exception) { "HTTP $code" })
        if (text.isBlank()) JSONObject() else if (text.trimStart().startsWith("[")) JSONObject().put("list", JSONArray(text)) else JSONObject(text)
    }) { r, err -> done(r, err) }
}

fun MainActivity.showAdmin() {
    val s = screen(t("Panneau admin"))
    s.note(t("Session ouverte pour 30 minutes."))
    s.row("📊 " + t("Statistiques"), t("Utilisateurs, temps, pays, versions"), onClick = { adminStats() })
    s.row("📣 " + t("Messages"), t("Envoyer une info ou une alerte aux navigateurs ouverts"), onClick = { adminMessages() })
    s.row("⛔ " + t("Arrêt d’urgence"), t("Bloquer ou débloquer tous les navigateurs"), onClick = { adminLockdown() })
    s.row("🐞 " + t("Rapports de bug"), t("Lire, prendre en charge, discuter"), onClick = { adminBugs() })
    s.row("🔑 " + t("Changer le jeton du serveur"), null, onClick = { app.admin.setToken(null); s.close(); adminTokenThen { showAdmin() } })
    s.row("🚪 " + t("Fermer la session admin"), null, onClick = { app.admin.sessionUntil = 0; s.close() })
}

private fun MainActivity.adminStats() {
    val s = screen(t("Statistiques"))
    s.note(t("Chargement…"))
    adminCall("GET", "/v1/stats") { st, err ->
        s.body.removeAllViews()
        if (st == null) { s.empty(t("Erreur : %s").format(err ?: "")); return@adminCall }
        val act = st.optJSONObject("active") ?: JSONObject()
        s.section(t("Utilisateurs"))
        s.row(t("En ligne maintenant"), (st.optJSONObject("live")?.optInt("total") ?: 0).toString())
        s.row(t("Actifs aujourd’hui / 7 jours / 30 jours"), "${act.optInt("today")} / ${act.optInt("week")} / ${act.optInt("month")}")
        s.row(t("Utilisateurs au total"), st.optInt("totalUsers").toString() + " · " + t("%d nouveaux sur 30 jours").format(st.optInt("newUsers30")))
        val h = st.optJSONObject("hours") ?: JSONObject(); val p = st.optJSONObject("pages") ?: JSONObject()
        s.row(t("Heures d’utilisation"), t("aujourd’hui %s · 30 jours %s").format(h.opt("today")?.toString() ?: "0", h.opt("month")?.toString() ?: "0"))
        s.row(t("Pages ouvertes"), t("aujourd’hui %s · 30 jours %s").format(p.opt("today")?.toString() ?: "0", p.opt("month")?.toString() ?: "0"))
        val r = st.optJSONObject("rating") ?: JSONObject()
        s.row(t("Note moyenne"), "${r.optDouble("average", 0.0)} ★ (${r.optInt("count")})")
        val os = st.optJSONObject("os") ?: JSONObject()
        s.row(t("Systèmes (30 jours)"), os.keys().asSequence().joinToString(" · ") { k -> (mapOf("win" to "Windows", "android" to "Android", "mac" to "macOS", "linux" to "Linux")[k] ?: k) + " " + os.optInt(k) })
        fun pairs(a: JSONArray?) = (0 until (a?.length() ?: 0)).joinToString(" · ") { val x = a!!.getJSONArray(it); "${x.get(0)} ${x.get(1)}" }
        s.row(t("Versions"), pairs(st.optJSONArray("versions")))
        s.row(t("Pays"), pairs(st.optJSONArray("countries")))
    }
}

private fun MainActivity.adminMessages() {
    val s = screen(t("Messages"))
    val msg = field(t("Message (400 caractères au plus)"), multi = true)
    val url = field(t("Lien « En savoir plus » (https://…, facultatif)"))
    val alert = android.widget.CheckBox(this).apply { text = t("Alerte (en orange)"); setTextColor(C.TEXT) }
    s.body.addView(msg, lp().margins(t = dp(10), b = dp(8))); s.body.addView(url, lp().margins(b = dp(8))); s.body.addView(alert, lp())
    val recent = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    fun render(cfg: JSONObject?) {
        recent.removeAllViews()
        val a = cfg?.optJSONArray("recent") ?: JSONArray()
        recent.addView(text(t("Navigateurs à l’écoute : %d").format(cfg?.optInt("listening") ?: 0), 13f, C.MUTED), lp().margins(t = dp(14), b = dp(6)))
        if (a.length() == 0) recent.addView(text(t("Aucun message envoyé ces dernières 24 heures."), 13f, C.MUTED))
        for (i in 0 until a.length()) {
            val m = a.getJSONObject(i)
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = rounded(C.SURFACE, dp(10)); setPadding(dp(10), dp(8), dp(6), dp(8)) }
            row.addView(text((if (m.optString("level") == "alert") "⚠️ " else "📣 ") + m.optString("text"), 14f), lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(button(t("Retirer")) { adminCall("DELETE", "/v1/admin/messages/" + m.optLong("id")) { c, e -> if (c != null) render(c) else toast(e ?: "") } })
            recent.addView(row, lp().margins(b = dp(6)))
        }
        if (a.length() > 1) recent.addView(button(t("Tout retirer")) { adminCall("DELETE", "/v1/admin/messages") { c, e -> if (c != null) render(c) else toast(e ?: "") } }, lp().margins(t = dp(4)))
    }
    s.body.addView(button(t("Envoyer aux navigateurs ouverts"), primary = true) {
        val text = msg.text.toString().trim(); if (text.isEmpty()) { toast(t("Message vide.")); return@button }
        val body = JSONObject().put("text", text).put("level", if (alert.isChecked) "alert" else "info")
        url.text.toString().trim().takeIf { it.isNotEmpty() }?.let { body.put("url", it) }
        adminCall("POST", "/v1/admin/messages", body) { c, e -> if (c != null) { msg.setText(""); url.setText(""); toast(t("Message envoyé à %d navigateur(s).").format(c.optInt("delivered"))); render(c) } else toast(t("Erreur : %s").format(e ?: "")) }
    }, lp().margins(t = dp(8)))
    s.body.addView(recent, lp())
    adminCall("GET", "/v1/admin/config") { c, e -> if (c != null) render(c) else toast(t("Erreur : %s").format(e ?: "")) }
}

private fun MainActivity.adminLockdown() {
    val s = screen(t("Arrêt d’urgence"))
    val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    s.body.addView(box, lp())
    fun render(c: JSONObject?) {
        box.removeAllViews()
        val l = c?.optJSONObject("lockdown") ?: JSONObject(); val on = l.optBoolean("active")
        box.addView(text(if (on) "⛔ " + t("ACTIF : les navigateurs sont bloqués.") else "✅ " + t("Inactif : les navigateurs fonctionnent normalement."), 16f, if (on) C.BAD else C.GOOD, bold = true), lp().margins(t = dp(12), b = dp(6)))
        if (on && l.optString("message").isNotEmpty()) box.addView(text(t("Motif :") + " " + l.optString("message"), 14f, C.MUTED))
        box.addView(text(t("Le blocage s’applique à tous les navigateurs (PC et Android), ouverts ou fermés, jusqu’au déblocage. Ce téléphone admin reste accessible."), 13f, C.MUTED), lp().margins(t = dp(8), b = dp(10)))
        if (on) box.addView(button(t("Débloquer tous les navigateurs"), primary = true) { adminCall("PUT", "/v1/admin/lockdown", JSONObject().put("active", false)) { r, e -> if (r != null) render(r) else toast(e ?: "") } }, lp())
        else {
            val reason = field(t("Motif affiché aux utilisateurs"))
            val confirmBox = field(t("Tape BLOQUER pour confirmer"))
            box.addView(reason, lp().margins(b = dp(8))); box.addView(confirmBox, lp().margins(b = dp(8)))
            box.addView(button(t("Bloquer tous les navigateurs")) {
                if (confirmBox.text.toString().trim() != "BLOQUER") { toast(t("Tape BLOQUER pour confirmer.")); return@button }
                adminCall("PUT", "/v1/admin/lockdown", JSONObject().put("active", true).put("message", reason.text.toString().trim()).put("versions", "")) { r, e -> if (r != null) render(r) else toast(e ?: "") }
            }, lp())
        }
    }
    adminCall("GET", "/v1/admin/config") { c, e -> if (c != null) render(c) else toast(t("Erreur : %s").format(e ?: "")) }
}

private fun MainActivity.adminBugs() {
    val s = screen(t("Rapports de bug"))
    val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    s.body.addView(button(t("Actualiser")) { loadBugs(s, list) }, lp().margins(t = dp(8), b = dp(8)))
    s.body.addView(list, lp())
    loadBugs(s, list)
}

private fun MainActivity.loadBugs(s: Screen, list: LinearLayout) {
    adminCall("GET", "/v1/admin/bugs") { r, e ->
        list.removeAllViews()
        val a = r?.optJSONArray("bugs") ?: run { list.addView(text(t("Erreur : %s").format(e ?: ""), 14f, C.MUTED)); return@adminCall }
        if (a.length() == 0) { list.addView(text(t("Aucun rapport."), 14f, C.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(30), 0, dp(30)) }, lp()); return@adminCall }
        val status = mapOf("new" to "🆕", "seen" to "👀", "fixed" to "✅", "support" to "💬")
        for (i in 0 until a.length()) {
            val b = a.getJSONObject(i)
            val title = (status[b.optString("status")] ?: "•") + " " + b.optString("text").take(90) + (if (b.optInt("unread") > 0) "  (${b.optInt("unread")} 💬)" else "")
            val tmp = Screen(this, "", android.widget.FrameLayout(this), ArrayList())
            val row = tmp.row(title, "v${b.optString("v")} · ${b.optString("os")} · ${b.optString("cc")} · ${b.optString("at").take(16).replace('T', ' ')}", onClick = { adminBug(b) { loadBugs(s, list) } })
            tmp.body.removeView(row); list.addView(row, lp().margins(b = dp(6)))
        }
    }
}

private fun MainActivity.adminBug(b: JSONObject, refresh: () -> Unit) {
    val id = b.optString("id")
    val s = screen(t("Rapport de bug"))
    s.body.addView(text(b.optString("text"), 15f).apply { setTextIsSelectable(true) }, lp().margins(t = dp(12), b = dp(8)))
    if (b.optString("contact").isNotEmpty()) s.note(t("Contact :") + " " + b.optString("contact"))
    s.note("v${b.optString("v")} · ${b.optString("os")} · ${b.optString("cc")} · ${b.optString("at")}")
    if (b.optBoolean("canChat")) s.body.addView(button(if (b.optBoolean("chatOpen")) "💬 " + t("Ouvrir la discussion") else "💬 " + t("Prendre en charge"), primary = true) {
        if (b.optBoolean("chatOpen")) adminChat(id)
        else adminCall("POST", "/v1/admin/support/$id/open", JSONObject().put("welcome", t("Bonjour ! Merci pour ton signalement. Je regarde ton problème avec toi."))) { r, e -> if (r != null) { b.put("chatOpen", true); adminChat(id); refresh() } else toast(e ?: "") }
    }, lp().margins(b = dp(8)))
    else s.note(t("Tchat impossible : ce rapport vient d’une version sans tchat."))
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    row.addView(button(t("Corrigé")) { adminCall("PATCH", "/v1/admin/bugs/$id", JSONObject().put("status", "fixed")) { r, e -> if (r != null) { toast(t("Marqué comme corrigé.")); refresh() } else toast(e ?: "") } }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(5)))
    row.addView(button(t("Supprimer")) {
        AlertDialog.Builder(this).setTitle(t("Supprimer ce rapport ?")).setNegativeButton(t("Annuler"), null).setPositiveButton(t("Supprimer")) { _, _ ->
            adminCall("DELETE", "/v1/admin/bugs/$id") { r, e -> if (r != null) { s.close(); refresh() } else toast(e ?: "") }
        }.show()
    }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = dp(5)))
    s.body.addView(row, lp())
    val log = b.optString("log")
    if (log.isNotEmpty()) { s.section(t("Journal")); s.body.addView(text(log.takeLast(4000), 11f, C.MUTED).apply { setTextIsSelectable(true); typeface = android.graphics.Typeface.MONOSPACE }, lp()) }
}

/** Discussion côté admin : rafraîchie toutes les 4 s tant que l'écran est ouvert. */
private fun MainActivity.adminChat(id: String) {
    val s = screen(t("Support — discussion avec l’utilisateur"))
    val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    s.body.addView(list, lp().margins(t = dp(8)))
    val input = field(t("Ta réponse…"))
    val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(C.BAR); setPadding(dp(10), dp(8), dp(10), dp(8)) }
    bar.addView(input, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(8)))
    var open = true; var lastSeq = -1; var alive = true
    fun render(v: JSONObject) {
        val seq = v.optInt("seq"); if (seq == lastSeq) return; lastSeq = seq
        val view = app.server.supportView(v) ?: return
        open = view.open; list.removeAllViews()
        for (m in view.messages) {
            if (m.from == "system") { list.addView(text(if (m.text == "open") t("Tu as pris ce signalement en charge.") else t("La discussion a été terminée."), 12f, C.MUTED).apply { gravity = Gravity.CENTER }, lp().margins(t = dp(6), b = dp(6))); continue }
            val mine = m.from == "admin"
            val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = if (mine) Gravity.END else Gravity.START }
            if (!mine) wrap.addView(text(t("Utilisateur"), 11f, C.MUTED))
            wrap.addView(text(m.text, 14.5f).apply { setPadding(dp(12), dp(8), dp(12), dp(8)); background = rounded(if (mine) C.ACCENT else C.SURFACE2, dp(14)); setTextIsSelectable(true) }, lp(ViewGroup.LayoutParams.WRAP_CONTENT))
            list.addView(wrap, lp().margins(b = dp(6)))
        }
        input.isEnabled = open
        (s.body.parent as? ScrollView)?.post { (s.body.parent as ScrollView).fullScroll(ScrollView.FOCUS_DOWN) }
    }
    fun refresh() { adminCall("GET", "/v1/admin/support/$id") { v, _ -> if (v != null) { render(v); adminCall("POST", "/v1/admin/support/$id/read", JSONObject()) { _, _ -> } } } }
    fun send() {
        val txt = input.text.toString().trim(); if (txt.isEmpty() || !open) return
        input.setText(""); adminCall("POST", "/v1/admin/support/$id/messages", JSONObject().put("text", txt)) { v, e -> if (v != null) render(v) else toast(e ?: "") }
    }
    input.setOnEditorActionListener { _, _, _ -> send(); true }
    bar.addView(button(t("Envoyer"), primary = true) { send() })
    s.root.addView(bar, lp())
    s.header.addView(text(t("Terminer"), 14f, C.BAD, bold = true).apply { setPadding(dp(10), dp(8), dp(10), dp(8)); setOnClickListener {
        AlertDialog.Builder(this@adminChat).setTitle(t("Terminer la discussion ?")).setNegativeButton(t("Annuler"), null)
            .setPositiveButton(t("Terminer")) { _, _ -> adminCall("POST", "/v1/admin/support/$id/close", JSONObject()) { v, _ -> if (v != null) render(v) } }.show()
    } })
    val tick = object : Runnable { override fun run() { if (!alive) return; refresh(); s.root.postDelayed(this, 4_000) } }
    s.onClose = { alive = false }
    tick.run()
}
