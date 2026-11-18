package inc.codexhempreur.devgitbrowser

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.Calendar

data class Achievement(val id: String, val icon: String, val category: String, val tier: String, val stat: String, val target: Long,
                       val nameFr: String, val descFr: String, val nameEn: String, val descEn: String) {
    val points get() = when (tier) { "bronze" -> 10; "silver" -> 25; "gold" -> 50; else -> 100 }
    val name get() = if (L.en) nameEn else nameFr
    val desc get() = if (L.en) descEn else descFr
}

/** Succès : mêmes règles que sur PC, statistiques 100 % locales (rien n'est envoyé). */
class Achievements(ctx: Context) {
    companion object {
        val CATEGORIES = listOf("time" to ("⏳" to ("Temps" to "Time")), "protection" to ("🛡️" to ("Protection" to "Protection")),
            "explore" to ("🧭" to ("Exploration" to "Exploration")), "security" to ("🔐" to ("Sécurité" to "Security")), "community" to ("🤝" to ("Communauté" to "Community")),
            "secret" to ("🗝️" to ("Secrets" to "Secrets")))
        val RANKS = listOf(Triple(0, "🌱", "Novice" to "Rookie"), Triple(100, "🧭", "Explorateur" to "Explorer"), Triple(300, "⚔️", "Aventurier" to "Adventurer"),
            Triple(700, "🏅", "Expert" to "Expert"), Triple(1200, "👑", "Maître DevGit" to "DevGit Master"), Triple(1800, "💎", "Légende" to "Legend"))
        val ALL = listOf(
            Achievement("first_steps", "👣", "time", "bronze", "minutes", 10, "Premiers pas", "Navigue 10 minutes avec DevGitBrowser.", "First steps", "Browse for 10 minutes with DevGitBrowser."),
            Achievement("hour_one", "⏱️", "time", "bronze", "minutes", 60, "Une heure de surf", "Passe 1 heure sur le navigateur.", "One hour of surfing", "Spend 1 hour in the browser."),
            Achievement("ten_hours", "⌛", "time", "silver", "minutes", 600, "Dix heures au compteur", "Passe 10 heures sur le navigateur.", "Ten hours on the clock", "Spend 10 hours in the browser."),
            Achievement("centurion", "🕰️", "time", "gold", "minutes", 6000, "Centurion", "Passe 100 heures sur le navigateur.", "Centurion", "Spend 100 hours in the browser."),
            Achievement("regular", "📅", "time", "silver", "days", 7, "Habitué", "Utilise DevGitBrowser 7 jours différents.", "Regular", "Use DevGitBrowser on 7 different days."),
            Achievement("faithful", "💍", "time", "gold", "days", 30, "Fidèle", "Utilise DevGitBrowser 30 jours différents.", "Faithful", "Use DevGitBrowser on 30 different days."),
            Achievement("streak7", "🔥", "time", "silver", "bestStreak", 7, "Série de feu", "Utilise le navigateur 7 jours d’affilée.", "On fire", "Use the browser 7 days in a row."),
            Achievement("streak30", "☄️", "time", "gold", "bestStreak", 30, "Inarrêtable", "Utilise le navigateur 30 jours d’affilée.", "Unstoppable", "Use the browser 30 days in a row."),
            Achievement("night_owl", "🦉", "time", "silver", "nightMinutes", 60, "Oiseau de nuit", "Navigue 1 heure entre minuit et 5 h du matin.", "Night owl", "Browse for 1 hour between midnight and 5 a.m."),
            Achievement("early_bird", "🐦", "time", "bronze", "morningMinutes", 30, "Lève-tôt", "Navigue 30 minutes entre 5 h et 7 h du matin.", "Early bird", "Browse for 30 minutes between 5 and 7 a.m."),
            Achievement("ads_100", "🛡️", "protection", "bronze", "ads", 100, "Bouclier levé", "DevGitShield bloque 100 publicités et pisteurs.", "Shield up", "DevGitShield blocks 100 ads and trackers."),
            Achievement("ads_1k", "🧱", "protection", "silver", "ads", 1000, "Muraille", "DevGitShield bloque 1 000 publicités et pisteurs.", "Great wall", "DevGitShield blocks 1,000 ads and trackers."),
            Achievement("ads_10k", "🏰", "protection", "gold", "ads", 10000, "Forteresse", "DevGitShield bloque 10 000 publicités et pisteurs.", "Fortress", "DevGitShield blocks 10,000 ads and trackers."),
            Achievement("ads_100k", "🐉", "protection", "platinum", "ads", 100000, "Gardien légendaire", "DevGitShield bloque 100 000 publicités et pisteurs.", "Legendary guardian", "DevGitShield blocks 100,000 ads and trackers."),
            Achievement("private_tabs", "🕶️", "protection", "bronze", "privateTabs", 10, "Passe-muraille", "Ouvre 10 onglets privés.", "Wall walker", "Open 10 private tabs."),
            Achievement("vault", "🔐", "security", "bronze", "vaultCreated", 1, "Coffre-fort", "Enregistre ton premier mot de passe.", "Safe keeper", "Save your first password."),
            Achievement("keyring", "🔑", "security", "silver", "passwords", 10, "Trousseau", "Garde 10 identifiants dans ton coffre.", "Key ring", "Keep 10 logins in your vault."),
            Achievement("explorer", "🧭", "explore", "bronze", "pages", 100, "Explorateur", "Visite 100 pages.", "Explorer", "Visit 100 pages."),
            Achievement("globetrotter", "🗺️", "explore", "silver", "pages", 1000, "Globe-trotter", "Visite 1 000 pages.", "Globetrotter", "Visit 1,000 pages."),
            Achievement("cartographer", "🌌", "explore", "gold", "pages", 10000, "Cartographe du web", "Visite 10 000 pages.", "Web cartographer", "Visit 10,000 pages."),
            Achievement("collector", "⭐", "explore", "bronze", "bookmarks", 10, "Collectionneur", "Ajoute 10 favoris.", "Collector", "Add 10 bookmarks."),
            Achievement("multitask", "📺", "explore", "bronze", "pip", 5, "Multitâche", "Utilise le Picture-in-Picture 5 fois.", "Multitasker", "Use Picture-in-Picture 5 times."),
            Achievement("juggler", "🗂️", "explore", "silver", "maxTabs", 20, "Jongleur", "Garde 20 onglets ouverts en même temps.", "Juggler", "Keep 20 tabs open at the same time."),
            Achievement("polyglot", "🌐", "explore", "bronze", "languages", 2, "Polyglotte", "Utilise l’interface dans 2 langues.", "Polyglot", "Use the interface in 2 languages."),
            Achievement("mover", "📥", "explore", "bronze", "imports", 1, "Déménageur", "Importe tes mots de passe depuis un autre navigateur.", "Mover", "Import your passwords from another browser."),
            Achievement("ambassador", "📣", "community", "bronze", "invites", 1, "Ambassadeur", "Partage ton lien d’invitation.", "Ambassador", "Share your invitation link."),
            Achievement("megaphone", "📢", "community", "silver", "invites", 10, "Porte-voix", "Partage ton lien d’invitation 10 fois.", "Megaphone", "Share your invitation link 10 times."),
            Achievement("first_referral", "🤝", "community", "silver", "referrals", 1, "Premier filleul", "Un ami installe DevGitBrowser avec ton code.", "First referral", "A friend installs DevGitBrowser with your code."),
            Achievement("recruiter", "👥", "community", "gold", "referrals", 5, "Recruteur", "5 amis installent DevGitBrowser avec ton code.", "Recruiter", "5 friends install DevGitBrowser with your code."),
            Achievement("legend", "👑", "community", "platinum", "referrals", 25, "Légende DevGit", "25 amis installent DevGitBrowser avec ton code.", "DevGit legend", "25 friends install DevGitBrowser with your code."),
            Achievement("bug_hunter", "🐞", "community", "silver", "bugs", 1, "Chasseur de bugs", "Envoie un rapport de bug.", "Bug hunter", "Send a bug report."),
            // Succès secrets : visibles seulement depuis le mode DGBx (comme sur PC).
            Achievement("dgbx_first", "🗝️", "secret", "bronze", "dgbxMinutes", 10, "Initié", "Passe 10 minutes dans le mode DGBx.", "Initiate", "Spend 10 minutes in DGBx mode."),
            Achievement("dgbx_hour", "🌙", "secret", "silver", "dgbxMinutes", 60, "Noctambule", "Passe 1 heure dans le mode DGBx.", "Night prowler", "Spend 1 hour in DGBx mode."),
            Achievement("dgbx_10h", "🎭", "secret", "gold", "dgbxMinutes", 600, "Double vie", "Passe 10 heures dans le mode DGBx.", "Double life", "Spend 10 hours in DGBx mode.")
        )
    }

    private val sp = ctx.getSharedPreferences("dgb-ach", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    var onUnlock: (List<Achievement>) -> Unit = {}
    private val stats: JSONObject = try { JSONObject(sp.getString("stats", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
    private val unlocked: JSONObject = try { JSONObject(sp.getString("unlocked", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

    fun value(stat: String): Long = when (stat) {
        "days" -> stats.optJSONObject("dayset")?.length()?.toLong() ?: 0
        "languages" -> stats.optJSONObject("langs")?.length()?.toLong() ?: 0
        else -> stats.optLong(stat, 0)
    }
    fun isUnlocked(id: String) = unlocked.has(id)
    val points get() = ALL.filter { isUnlocked(it.id) }.sumOf { it.points }
    fun rank() = RANKS.last { points >= it.first }
    fun nextRank() = RANKS.firstOrNull { points < it.first }

    @Synchronized fun bump(stat: String, n: Long = 1) { if (n <= 0) return; stats.put(stat, stats.optLong(stat, 0) + n); commit() }
    @Synchronized fun atLeast(stat: String, v: Long) { if (v > stats.optLong(stat, 0)) { stats.put(stat, v); commit() } }
    @Synchronized fun language(lang: String) { val o = stats.optJSONObject("langs") ?: JSONObject(); o.put(lang, 1); stats.put("langs", o); commit() }

    /** Une minute d'utilisation : temps, nuit/matin, jours et séries. */
    @Synchronized fun minute() {
        val c = Calendar.getInstance(); val h = c.get(Calendar.HOUR_OF_DAY)
        stats.put("minutes", stats.optLong("minutes") + 1)
        if (h < 5) stats.put("nightMinutes", stats.optLong("nightMinutes") + 1)
        if (h in 5..6) stats.put("morningMinutes", stats.optLong("morningMinutes") + 1)
        val day = "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
        val days = stats.optJSONObject("dayset") ?: JSONObject()
        if (!days.has(day)) {
            days.put(day, 1); stats.put("dayset", days)
            c.add(Calendar.DAY_OF_MONTH, -1)
            val yesterday = "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
            val streak = if (stats.optString("lastDay") == yesterday) stats.optLong("streak") + 1 else 1
            stats.put("streak", streak); stats.put("lastDay", day)
            if (streak > stats.optLong("bestStreak")) stats.put("bestStreak", streak)
        }
        commit()
    }

    private fun commit() {
        val fresh = ArrayList<Achievement>()
        for (a in ALL) if (!unlocked.has(a.id) && value(a.stat) >= a.target) { unlocked.put(a.id, System.currentTimeMillis()); fresh.add(a) }
        sp.edit().putString("stats", stats.toString()).putString("unlocked", unlocked.toString()).apply()
        if (fresh.isNotEmpty()) main.post { onUnlock(fresh) }
    }
}
