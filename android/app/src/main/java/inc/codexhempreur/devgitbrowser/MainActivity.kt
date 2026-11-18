package inc.codexhempreur.devgitbrowser

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PictureInPictureParams
import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.provider.Settings
import android.text.InputType
import android.util.Rational
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.Calendar

class Tab(val id: Int, val private: Boolean, var web: WebView) {
    var url = ""
    var title = ""
    var pending: String? = null
    var progress = 100
    var popup = false
    @Volatile var pageHost = ""
    @Volatile var blocked = 0
    var desktop = false
    var mixedBlocked = false
    var mixedDismissed = false
    var mixedReloaded = ""
    var httpsFallback: Pair<String, String>? = null
    var usedMedia = false
    val bypass: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())
    var icon: Bitmap? = null
    val isHome get() = url.isEmpty() && pending == null && !popup
}

@SuppressLint("SetJavaScriptEnabled")
@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class MainActivity : Activity() {
    companion object {
        private const val REQ_FILE = 1; private const val REQ_MEDIA = 2; private const val REQ_GEO = 3
        private const val REQ_AUTH = 4; private const val REQ_CSV = 5; private const val REQ_NOTIF = 6; private const val REQ_STORAGE = 7
        private const val MAX_TABS = 30
        private const val HOME_SITE = "https://www.BabelVisio.com"
        private const val LAYOUT_FLAGS = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    private val a get() = app
    private val ui = Handler(Looper.getMainLooper())
    private val tabs = ArrayList<Tab>()
    private var active: Tab? = null
    private var nextId = 1
    private var resumed = false

    private lateinit var root: FrameLayout
    private lateinit var column: LinearLayout
    private lateinit var topBar: LinearLayout
    private lateinit var address: EditText
    private lateinit var siteIcon: ImageView
    private lateinit var tabCount: TextView
    private lateinit var progress: ProgressBar
    private lateinit var banners: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var findBar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView
    private lateinit var overlay: FrameLayout
    private lateinit var fullscreen: FrameLayout
    private var lockView: View? = null
    private val screens = ArrayList<Screen>()
    private var homeView: View? = null

    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMedia: Pair<PermissionRequest, List<String>>? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private var afterAuth: (() -> Unit)? = null
    private var afterStorage: (() -> Unit)? = null
    private var privateProfile: String? = null
    private val shownMessages = LinkedHashMap<Long, LiveMessage>()
    private var updateProgress = -1

    // ======================================================================== Cycle de vie
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        cleanupProfiles()
        createChannels()
        a.shield.start()
        wireServer()
        a.tor.onState = { st -> refreshUi(); refreshBanners(); if (st == TorMode.State.ON) { toast(t("Mode Tor actif.")); active?.let { select(it) } } }
        a.achievements.onUnlock = { list -> toast("🏅 " + t("Succès débloqué :") + " " + list.joinToString(", ") { it.icon + " " + it.name }) }
        a.achievements.language(if (L.en) "en" else "fr")
        if (a.server.locked && !a.admin.hasToken) engageLock(a.server.currentLock()) else restoreTabs()
        handleIntent(intent, fromCreate = true)
        if (tabs.isEmpty() && lockView == null) openTab(null)
        ui.postDelayed({ checkUpdates(silent = true) }, 8_000)
        ui.postDelayed(object : Runnable { override fun run() { checkUpdates(silent = true); a.shield.let { s -> Thread { s.refresh(false) }.start() }; ui.postDelayed(this, 30 * 60_000L) } }, 30 * 60_000L)
        refreshBanners()
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent, fromCreate = false) }

    private val minuteTick = object : Runnable {
        override fun run() {
            if (resumed && a.prefs.telemetry == 1) a.server.minutes = minOf(a.server.minutes + 1, 600)
            if (resumed) a.achievements.minute()
            a.achievements.bump("ads", a.shield.totalBlocked.getAndSet(0).toLong())
            matchPulse.reap(tabs.any { MatchPulse.isBookmaker(UrlTools.host(it.pending ?: it.url)) })
            ui.postDelayed(this, 60_000)
        }
    }

    override fun onResume() { super.onResume(); resumed = true; active?.web?.onResume(); ui.postDelayed(minuteTick, 60_000) }
    override fun onPause() {
        super.onPause(); resumed = false; ui.removeCallbacks(minuteTick)
        CookieManager.getInstance().flush()
    }
    override fun onStop() { super.onStop(); saveTabs() }
    override fun onDestroy() { for (t in tabs) destroyWeb(t.web); super.onDestroy() }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Vidéo en plein écran : elle continue en petite fenêtre (Picture-in-Picture).
        if (customView != null && Build.VERSION.SDK_INT >= 26 && packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            try { if (enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())) a.achievements.bump("pip") } catch (_: Exception) {}
        }
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPip, newConfig)
        column.visibility = if (inPip) View.GONE else View.VISIBLE
    }

    override fun onBackPressed() {
        when {
            customView != null -> exitFullscreen()
            screens.isNotEmpty() -> screens.last().close()
            findBar.visibility == View.VISIBLE -> closeFind()
            address.hasFocus() -> { address.clearFocus(); hideKeyboard() }
            active?.let { !it.isHome && it.web.canGoBack() } == true -> active!!.web.goBack()
            active?.let { !it.isHome && it.popup && tabs.size > 1 } == true -> closeTab(active!!)
            active?.let { !it.isHome } == true -> showHome(active!!)
            else -> moveTaskToBack(true)
        }
    }

    private fun handleIntent(i: Intent?, fromCreate: Boolean) {
        if (i == null) return
        i.getStringExtra("dgb-open")?.takeIf { it.startsWith("support:") }?.let { id -> lastSupport[id.removePrefix("support:")]?.let { showSupportChat(it) } }
        val url = when (i.action) {
            Intent.ACTION_VIEW -> i.dataString?.takeIf { UrlTools.isWeb(it) }
            Intent.ACTION_WEB_SEARCH -> i.getStringExtra(SearchManager.QUERY)?.let { UrlTools.searchOrAddress(it, a.prefs.engine) }
            else -> null
        } ?: return
        if (lockView != null) return
        openTab(url)
        if (!fromCreate) screens.toList().forEach { it.close() }
    }

    // ======================================================================== Interface
    private fun buildUi() {
        window.statusBarColor = C.BAR; window.navigationBarColor = C.BAR
        // Même comportement sur toutes les versions : l'application dessine sous les barres système et gère les marges.
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false) else window.decorView.systemUiVisibility = LAYOUT_FLAGS
        root = FrameLayout(this).apply { setBackgroundColor(C.BAR) }
        column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(C.BG) }

        topBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(C.BAR); setPadding(dp(4), dp(6), dp(4), dp(6)) }
        topBar.addView(iconButton(R.drawable.ic_home, t("Accueil")) { active?.let { showHome(it) } })
        val box = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = rounded(C.SURFACE, dp(22), dp(1), C.LINE); setPadding(dp(4), 0, dp(10), 0) }
        siteIcon = ImageView(this).apply { setImageResource(R.drawable.ic_info); setColorFilter(C.MUTED); scaleType = ImageView.ScaleType.CENTER; ripple(dp(16)); contentDescription = t("Informations sur le site"); setOnClickListener { showSiteInfo() } }
        box.addView(siteIcon, LinearLayout.LayoutParams(dp(34), dp(34)))
        address = EditText(this).apply {
            setSingleLine(); setTextColor(C.TEXT); setHintTextColor(C.MUTED); textSize = 15f; background = null
            hint = t("Rechercher ou saisir une adresse"); setPadding(dp(4), dp(8), dp(4), dp(8))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_EXTRACT_UI; setSelectAllOnFocus(true)
            setOnEditorActionListener { _, id, ev -> if (id == EditorInfo.IME_ACTION_GO || ev?.keyCode == KeyEvent.KEYCODE_ENTER) { navigate(text.toString()); true } else false }
            setOnFocusChangeListener { _, focus -> if (focus) { setText(active?.let { it.pending ?: it.url } ?: ""); selectAll() } else refreshUi() }
        }
        box.addView(address, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        topBar.addView(box, lp(0, dp(44), 1f).margins(l = dp(2), r = dp(4)))
        tabCount = text("1", 13f, bold = true).apply {
            gravity = Gravity.CENTER; background = rounded(Color.TRANSPARENT, dp(7), dp(2), C.TEXT); contentDescription = t("Onglets")
            setOnClickListener { showTabs() }
        }
        val tabWrap = FrameLayout(this).apply { ripple(dp(20)); setOnClickListener { showTabs() } }
        tabWrap.addView(tabCount, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
        topBar.addView(tabWrap, LinearLayout.LayoutParams(dp(42), dp(42)))
        val menuBtn = iconButton(R.drawable.ic_more, t("Menu")) {}
        menuBtn.setOnClickListener { showMenu(menuBtn) }
        topBar.addView(menuBtn)
        column.addView(topBar, lp())

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; progressTintList = ColorStateList.valueOf(C.ACCENT); progressBackgroundTintList = ColorStateList.valueOf(C.BAR); visibility = View.INVISIBLE }
        column.addView(progress, lp(h = dp(3)))
        banners = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(banners, lp())
        content = FrameLayout(this).apply { setBackgroundColor(C.BG) }
        column.addView(content, lp(h = 0, weight = 1f))
        buildFindBar()
        column.addView(findBar, lp())

        root.addView(column, FrameLayout.LayoutParams(-1, -1))
        overlay = FrameLayout(this).apply { visibility = View.GONE }
        root.addView(overlay, FrameLayout.LayoutParams(-1, -1))
        fullscreen = FrameLayout(this).apply { setBackgroundColor(Color.BLACK); visibility = View.GONE }
        root.addView(fullscreen, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        matchPulse = MatchPulse(this, root)

        // Écran bord à bord (Android 15) : barres système et clavier gérés à la main.
        root.setOnApplyWindowInsetsListener { _, insets ->
            val (l, tp, r, b) = if (Build.VERSION.SDK_INT >= 30) {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                listOf(i.left, i.top, i.right, i.bottom)
            } else listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            column.setPadding(l, tp, r, b); overlay.setPadding(l, tp, r, b)
            lockView?.setPadding(l + dp(24), tp + dp(24), r + dp(24), b + dp(24))
            insets
        }
    }

    private fun buildFindBar() {
        findBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(C.BAR); setPadding(dp(8), dp(4), dp(4), dp(4)); visibility = View.GONE }
        findInput = EditText(this).apply {
            setSingleLine(); setTextColor(C.TEXT); setHintTextColor(C.MUTED); hint = t("Rechercher dans la page"); textSize = 15f
            background = rounded(C.SURFACE, dp(10)); setPadding(dp(10), dp(8), dp(10), dp(8)); imeOptions = EditorInfo.IME_ACTION_SEARCH
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { active?.web?.findAllAsync(s?.toString() ?: "") }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
            setOnEditorActionListener { _, _, _ -> active?.web?.findNext(true); true }
        }
        findBar.addView(findInput, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        findCount = text("", 13f, C.MUTED).apply { setPadding(dp(8), 0, dp(4), 0) }
        findBar.addView(findCount)
        findBar.addView(text("↑", 20f).apply { gravity = Gravity.CENTER; ripple(dp(18)); setOnClickListener { active?.web?.findNext(false) } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        findBar.addView(text("↓", 20f).apply { gravity = Gravity.CENTER; ripple(dp(18)); setOnClickListener { active?.web?.findNext(true) } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        findBar.addView(text("✕", 18f).apply { gravity = Gravity.CENTER; ripple(dp(18)); setOnClickListener { closeFind() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
    }

    private fun openFind() {
        val t = active ?: return; if (t.isHome) return
        findBar.visibility = View.VISIBLE; findInput.requestFocus(); showKeyboard(findInput)
        t.web.setFindListener { cur, total, _ -> findCount.text = if (total == 0) "0/0" else "${cur + 1}/$total" }
    }
    private fun closeFind() { findBar.visibility = View.GONE; active?.web?.clearMatches(); findInput.setText(""); hideKeyboard() }

    private fun showKeyboard(v: View) { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(v, 0) }
    private fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(root.windowToken, 0) }
    internal fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
    internal fun screen(title: String) = Screen(this, title, overlay, screens).show()
    internal val chatViews = HashMap<String, (SupportView) -> Unit>()
    private val lastSupport = HashMap<String, SupportView>()
    private lateinit var matchPulse: MatchPulse

    private fun refreshUi() {
        val t = active
        tabCount.text = if (tabs.size > 99) ":)" else tabs.size.toString()
        val privateMode = t?.private == true
        topBar.setBackgroundColor(when { a.tor.state == TorMode.State.ON -> 0xFF2D1B4E.toInt(); privateMode -> C.PRIVATE; else -> C.BAR })
        if (!address.hasFocus()) address.setText(when {
            t == null || t.isHome -> ""
            else -> UrlTools.display(t.pending ?: t.url)
        })
        val url = t?.url ?: ""
        siteIcon.setImageResource(if (url.startsWith("https://")) R.drawable.ic_lock else R.drawable.ic_info)
        siteIcon.setColorFilter(when { url.startsWith("https://") -> C.GOOD; url.startsWith("http://") -> C.WARN; else -> C.MUTED })
        progress.visibility = if (t != null && !t.isHome && t.progress < 100) View.VISIBLE else View.INVISIBLE
        progress.progress = t?.progress ?: 100
        refreshBanners()
    }

    // ======================================================================== Onglets
    private fun profileSupported() = try { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) } catch (_: Throwable) { false }

    private fun cleanupProfiles() {
        if (!profileSupported()) return
        try {
            val store = ProfileStore.getInstance()
            for (name in store.allProfileNames) if (name.startsWith("private-")) try { store.deleteProfile(name) } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    /** Onglets privés : profil séparé (cookies, stockage, cache), effacé à la fermeture du dernier onglet privé. */
    private fun privateProfileName(): String? {
        if (!profileSupported()) return null
        privateProfile?.let { return it }
        val name = "private-" + System.currentTimeMillis()
        ProfileStore.getInstance().getOrCreateProfile(name)
        privateProfile = name
        return name
    }

    private fun desktopUa(base: String): String {
        val chrome = Regex("Chrome/([\\d.]+)").find(base)?.groupValues?.get(1) ?: "130.0.0.0"
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chrome Safari/537.36"
    }
    private var mobileUa = ""

    private fun newWebView(t: Tab?, private: Boolean): WebView {
        val w = WebView(this)
        if (private) privateProfileName()?.let { WebViewCompat.setProfile(w, it) }
        w.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            setSupportMultipleWindows(true); javaScriptCanOpenWindowsAutomatically = false
            loadWithOverviewMode = true; useWideViewPort = true
            builtInZoomControls = true; displayZoomControls = false; setSupportZoom(true)
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false; allowContentAccess = false
            setGeolocationEnabled(true)
            // « ; wv » fait refuser certaines connexions (Google…) aux navigateurs intégrés : on présente un Chrome mobile normal.
            if (mobileUa.isEmpty()) mobileUa = userAgentString.replace("; wv)", ")").replace(Regex("Version/\\d+\\.\\d+ "), "")
            userAgentString = if (t?.desktop == true) desktopUa(mobileUa) else mobileUa
        }
        try {
            val cm = if (private && privateProfile != null) ProfileStore.getInstance().getProfile(privateProfile!!)?.cookieManager ?: CookieManager.getInstance() else CookieManager.getInstance()
            cm.setAcceptThirdPartyCookies(w, true)
        } catch (_: Exception) {}
        w.setBackgroundColor(Color.WHITE)
        matchPulse.install(w)
        a.tor.protect(w)
        return w
    }

    private fun openTab(url: String?, private: Boolean = false, background: Boolean = false, popup: Boolean = false): Tab? {
        if (lockView != null) return null
        if (tabs.size >= MAX_TABS) { toast(t("Maximum de %d onglets atteint.").format(MAX_TABS)); return null }
        if (private && !profileSupported()) {
            AlertDialog.Builder(this).setTitle(t("Mode privé indisponible"))
                .setMessage(t("Le mode privé a besoin d’une version récente d’« Android System WebView ». Mets-la à jour depuis le Play Store, puis réessaie."))
                .setPositiveButton(t("Ouvrir le Play Store")) { _, _ -> openExternal("market://details?id=com.google.android.webview", true) }
                .setNegativeButton(t("Fermer"), null).show()
            return null
        }
        val placeholder = Tab(nextId++, private, newWebView(null, private))
        placeholder.popup = popup
        attach(placeholder)
        val idx = active?.let { tabs.indexOf(it) + 1 } ?: tabs.size
        tabs.add(idx.coerceIn(0, tabs.size), placeholder)
        if (!background || active == null) select(placeholder)
        if (url != null) { if (placeholder === active) load(placeholder, url) else placeholder.pending = url }
        a.achievements.atLeast("maxTabs", tabs.size.toLong()); if (private) a.achievements.bump("privateTabs")
        refreshUi()
        return placeholder
    }

    private fun select(t: Tab) {
        val old = active
        if (old != null && old !== t && !old.usedMedia) old.web.onPause()
        active = t
        closeFind()
        content.removeAllViews()
        if (t.pending != null) { val p = t.pending!!; t.pending = null; load(t, p) }
        if (t.isHome) content.addView(buildHome(t), FrameLayout.LayoutParams(-1, -1))
        else { (t.web.parent as? ViewGroup)?.removeView(t.web); content.addView(t.web, FrameLayout.LayoutParams(-1, -1)); t.web.onResume() }
        refreshUi()
    }

    private fun showHome(t: Tab) {
        if (t !== active) return
        t.web.stopLoading(); t.url = ""; t.title = ""; t.popup = false; t.pending = null
        t.web.loadUrl("about:blank"); t.web.clearHistory()
        select(t)
    }

    private fun closeTab(t: Tab) {
        val i = tabs.indexOf(t); if (i < 0) return
        tabs.removeAt(i)
        if (t === active) { active = null; content.removeAllViews() }
        destroyWeb(t.web)
        if (t.private && tabs.none { it.private }) dropPrivateProfile()
        if (tabs.isEmpty()) openTab(null) else if (active == null) select(tabs[minOf(i, tabs.size - 1)])
        refreshUi()
    }

    private fun dropPrivateProfile() {
        val name = privateProfile ?: return
        privateProfile = null
        ui.postDelayed({ try { ProfileStore.getInstance().deleteProfile(name) } catch (_: Exception) {} }, 1500)
    }

    private fun destroyWeb(w: WebView) {
        try { (w.parent as? ViewGroup)?.removeView(w); w.stopLoading(); w.webChromeClient = null; w.destroy() } catch (_: Exception) {}
    }

    private fun navigate(text: String) {
        if (AdminKeys.COMMAND.matches(text)) { address.clearFocus(); hideKeyboard(); refreshUi(); showAdminLogin(); return }
        val url = UrlTools.searchOrAddress(text, a.prefs.engine) ?: return
        address.clearFocus(); hideKeyboard()
        val t = active ?: openTab(null) ?: return
        load(t, url)
    }

    private fun load(tab: Tab, url0: String) {
        if (a.tor.state == TorMode.State.STARTING) { tab.pending = url0; toast(t("Patiente : connexion au réseau Tor en cours…")); refreshUi(); return }
        var url = url0
        if (a.prefs.httpsFirst) UrlTools.httpsUpgrade(url)?.let { tab.httpsFallback = it to url; url = it }
        else tab.httpsFallback = null
        tab.url = url; tab.title = UrlTools.display(url); tab.popup = false
        applyMixedMode(tab, url)
        if (tab === active && content.indexOfChild(tab.web) < 0) { content.removeAllViews(); (tab.web.parent as? ViewGroup)?.removeView(tab.web); content.addView(tab.web, FrameLayout.LayoutParams(-1, -1)); tab.web.onResume() }
        tab.web.loadUrl(url)
        refreshUi()
    }

    private fun applyMixedMode(t: Tab, url: String): Boolean {
        val allow = url.startsWith("https://") && a.store.sitePermission(UrlTools.origin(url), "insecure") == "allow"
        val mode = if (allow) WebSettings.MIXED_CONTENT_ALWAYS_ALLOW else WebSettings.MIXED_CONTENT_NEVER_ALLOW
        if (t.web.settings.mixedContentMode == mode) return false
        t.web.settings.mixedContentMode = mode; return true
    }

    private fun saveTabs() {
        if (lockView != null) return
        val arr = JSONArray()
        for (t in tabs) { if (t.private) continue; val u = t.pending ?: t.url; if (UrlTools.isWeb(u)) arr.put(JSONObject().put("url", u).put("title", t.title)) }
        val activeIdx = tabs.filter { !it.private && UrlTools.isWeb(it.pending ?: it.url) }.indexOf(active)
        a.prefs.tabs = JSONObject().put("tabs", arr).put("active", activeIdx).toString()
    }

    private fun restoreTabs() {
        try {
            val o = JSONObject(a.prefs.tabs); val arr = o.getJSONArray("tabs")
            for (i in 0 until minOf(arr.length(), MAX_TABS)) {
                val e = arr.getJSONObject(i)
                val t = Tab(nextId++, false, newWebView(null, false))
                attach(t); t.pending = e.getString("url"); t.title = e.optString("title"); tabs.add(t)
            }
            if (tabs.isNotEmpty()) select(tabs[o.optInt("active", 0).coerceIn(0, tabs.size - 1)])
        } catch (_: Exception) {}
    }

    private fun showTabs() {
        val s = Screen(this, t("Onglets"), overlay, screens).show()
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(button(t("+ Nouvel onglet"), primary = true) { s.close(); openTab(null) }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(6)))
        actions.addView(button(t("+ Privé")) { s.close(); openTab(null, private = true) }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = dp(6)))
        s.body.addView(actions, lp().margins(t = dp(8), b = dp(10)))
        fun fill() {
            while (s.body.childCount > 1) s.body.removeViewAt(1)
            for (tab in tabs.toList()) {
                val label = (if (tab.private) "🕶 " else "") + (if (tab.isHome) t("Nouvel onglet") else tab.title.ifBlank { UrlTools.display(tab.url) })
                val close = text("✕", 18f, C.MUTED).apply { gravity = Gravity.CENTER; ripple(dp(18)); contentDescription = t("Fermer l’onglet") }
                val row = s.row(label, if (tab.isHome) null else UrlTools.display(tab.pending ?: tab.url), onClick = { s.close(); select(tab) }, trailing = close)
                close.setOnClickListener { closeTab(tab); if (tabs.isEmpty()) s.close() else fill() }
                if (tab === active) row.background = rounded(C.SURFACE2, dp(12), dp(1), C.ACCENT)
                close.layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
            }
            if (tabs.size > 1) s.body.addView(button(t("Fermer tous les onglets")) { tabs.toList().forEach { closeTab(it) }; s.close() }, lp().margins(t = dp(12)))
        }
        fill()
    }

    // ======================================================================== Moteur web : clients
    private fun attach(t: Tab) {
        t.web.webViewClient = PageClient(t)
        t.web.webChromeClient = ChromeClient(t)
        t.web.setDownloadListener { url, ua, cd, mime, _ -> download(t, url, ua, cd, mime) }
    }

    private fun tabOf(w: WebView?) = tabs.firstOrNull { it.web === w }

    private inner class PageClient(val tab: Tab) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url; val scheme = uri.scheme?.lowercase() ?: ""
            if (scheme == "devgit") { internal(tab, uri); return true }
            if (scheme == "http" || scheme == "https") {
                if (request.isForMainFrame && applyMixedMode(tab, uri.toString()) && request.isRedirect) { view.loadUrl(uri.toString()); return true }
                return false
            }
            if (scheme in setOf("about", "blob", "data", "javascript", "file", "content")) return scheme == "file" || scheme == "content"
            if (!request.hasGesture()) {
                AlertDialog.Builder(this@MainActivity).setMessage(t("Ce site veut ouvrir une autre application. Continuer ?"))
                    .setPositiveButton(t("Ouvrir")) { _, _ -> openExternal(uri.toString(), false, tab) }.setNegativeButton(t("Annuler"), null).show()
            } else openExternal(uri.toString(), false, tab)
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val scheme = request.url.scheme ?: return null
            if (scheme != "http" && scheme != "https") return null
            // Connexion à Tor en cours : aucune requête ne part en direct.
            if (a.tor.state == TorMode.State.STARTING) return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
            val host = request.url.host?.lowercase() ?: return null
            if (request.isForMainFrame) {
                if (a.prefs.phishing && !tab.bypass.contains(host) && a.shield.dangerous(host)) return htmlPage(dangerPage(host, request.url.toString()))
                return null
            }
            val page = tab.pageHost
            if (a.prefs.shield && !a.store.shieldAllowed(page) && a.shield.blocks(host, page)) {
                tab.blocked++; a.shield.totalBlocked.incrementAndGet()
                return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            if (!UrlTools.isWeb(url)) return
            tab.url = url; tab.pageHost = UrlTools.host(url); tab.blocked = 0; tab.mixedBlocked = false; tab.mixedDismissed = false; tab.icon = favicon; tab.popup = false
            // Autorisation « contenu non chiffré » du site atteint (redirection comprise) : rechargement unique si elle change.
            if (applyMixedMode(tab, url) && tab.mixedReloaded != UrlTools.origin(url)) { tab.mixedReloaded = UrlTools.origin(url); view.reload() }
            a.server.countPage(); a.achievements.bump("pages")
            if (tab === active) { if (content.indexOfChild(view) < 0) select(tab) else refreshUi() }
        }

        override fun onPageFinished(view: WebView, url: String) {
            tab.progress = 100
            if (!tab.private && UrlTools.isWeb(url)) a.store.visit(url, view.title ?: "")
            if (tab === active) refreshUi()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            if (!UrlTools.isWeb(url)) return
            tab.url = url; tab.pageHost = UrlTools.host(url)
            if (tab === active) refreshUi()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) httpsFallback(view, request.url.toString())
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            if (httpsFallback(view, error.url)) return
            if (tab === active && UrlTools.host(error.url) == tab.pageHost) toast(t("Certificat de sécurité invalide : la page a été bloquée."))
        }

        private fun httpsFallback(view: WebView, url: String): Boolean {
            val fb = tab.httpsFallback ?: return false
            if (url.trimEnd('/') != fb.first.trimEnd('/')) return false
            tab.httpsFallback = null; tab.url = fb.second
            view.loadUrl(fb.second)
            if (tab === active) toast(t("Ce site ne propose pas HTTPS : ouvert en http (non chiffré)."))
            return true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            val gone = tabOf(view) ?: return true
            val url = gone.url
            destroyWeb(view)
            gone.web = newWebView(gone, gone.private); attach(gone)
            if (gone === active) { content.removeAllViews(); if (UrlTools.isWeb(url)) load(gone, url) else select(gone); toast(t("La page a planté : elle a été rechargée.")) }
            else gone.pending = url.takeIf { UrlTools.isWeb(it) }
            return true
        }
    }

    private fun htmlPage(html: String) = WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(html.toByteArray()))
    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun dangerPage(host: String, url: String): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t("Site dangereux"))}</title>
<style>body{margin:0;font-family:sans-serif;background:#2a0b14;color:#ffe7ec;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:520px;padding:28px}
h1{font-size:24px}a{display:block;text-align:center;padding:14px;border-radius:12px;margin-top:14px;text-decoration:none}.ok{background:#fff;color:#2a0b14;font-weight:700}.go{color:#ffb3c2;font-size:13px}</style></head>
<body><main><h1>⛔ ${esc(t("Site signalé comme dangereux"))}</h1><p><b>${esc(host)}</b> ${esc(t("figure sur les listes publiques de sites d’hameçonnage ou de logiciels malveillants. Il peut essayer de voler tes mots de passe ou tes données bancaires."))}</p>
<a class="ok" href="devgit://home">${esc(t("Revenir en sécurité"))}</a><a class="go" href="devgit://bypass?u=${Uri.encode(url)}">${esc(t("Je comprends le risque, continuer"))}</a></main></body></html>"""

    private fun internal(tab: Tab, uri: Uri) {
        when (uri.host) {
            "home" -> showHome(tab)
            "bypass" -> uri.getQueryParameter("u")?.takeIf { UrlTools.isWeb(it) }?.let { tab.bypass.add(UrlTools.host(it)); tab.web.loadUrl(it) }
        }
    }

    private fun openExternal(url: String, plain: Boolean, tab: Tab? = null) {
        try {
            val intent = if (!plain && url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
            } else Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addCategory(Intent.CATEGORY_BROWSABLE) }
            try { startActivity(intent) }
            catch (e: ActivityNotFoundException) {
                val fallback = intent.getStringExtra("browser_fallback_url")
                if (tab != null && UrlTools.isWeb(fallback)) load(tab, fallback!!) else toast(t("Aucune application ne peut ouvrir ce lien."))
            }
        } catch (_: Exception) { toast(t("Aucune application ne peut ouvrir ce lien.")) }
    }

    private inner class ChromeClient(val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) { tab.progress = p; if (tab === active) refreshUi() }
        override fun onReceivedTitle(view: WebView, title: String?) {
            if (title.isNullOrBlank() || title == "about:blank") return
            tab.title = title.take(120); if (!tab.private) a.store.updateTitle(tab.url, tab.title)
        }
        override fun onReceivedIcon(view: WebView, icon: Bitmap?) { tab.icon = icon }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view; customCallback = callback
            fullscreen.addView(view, FrameLayout.LayoutParams(-1, -1)); fullscreen.visibility = View.VISIBLE
            systemBars(false); requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        }
        override fun onHideCustomView() { exitFullscreen() }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) { toast(t("Fenêtre pop-up bloquée.")); return false }
            val child = openTab(null, private = tab.private, popup = true) ?: return false
            (resultMsg.obj as WebView.WebViewTransport).webView = child.web
            resultMsg.sendToTarget()
            return true
        }
        override fun onCloseWindow(window: WebView) { tabOf(window)?.let { closeTab(it) } }

        override fun onPermissionRequest(request: PermissionRequest) { ui.post { mediaRequest(tab, request) } }
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) { geoRequest(origin, callback) }

        override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null); fileCallback = cb
            return try { startActivityForResult(params.createIntent(), REQ_FILE); true }
            catch (_: Exception) { fileCallback = null; toast(t("Impossible d’ouvrir le sélecteur de fichiers.")); false }
        }

        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
            val msg = m.message() ?: return false
            if (!tab.mixedBlocked && msg.startsWith("Mixed Content:") && msg.contains("blocked", ignoreCase = true) && tab.web.settings.mixedContentMode != WebSettings.MIXED_CONTENT_ALWAYS_ALLOW) {
                tab.mixedBlocked = true; if (tab === active) refreshBanners()
            }
            return false
        }

        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }

    private fun exitFullscreen() {
        val v = customView ?: return
        fullscreen.removeView(v); fullscreen.visibility = View.GONE
        customView = null; customCallback?.onCustomViewHidden(); customCallback = null
        systemBars(true); requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    private fun systemBars(show: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController ?: return
            if (show) c.show(WindowInsets.Type.systemBars()) else { c.hide(WindowInsets.Type.systemBars()); c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE }
        } else {
            window.decorView.systemUiVisibility = if (show) LAYOUT_FLAGS else (LAYOUT_FLAGS or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    // ======================================================================== Autorisations (caméra, micro, position)
    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun mediaRequest(tab: Tab, request: PermissionRequest) {
        val origin = UrlTools.origin(request.origin.toString())
        val res = request.resources.toList()
        val extra = res.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
        val cam = PermissionRequest.RESOURCE_VIDEO_CAPTURE in res && a.store.sitePermission(origin, "camera") != "block"
        val mic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in res && a.store.sitePermission(origin, "microphone") != "block"
        if (!cam && !mic) { if (extra.isEmpty()) request.deny() else request.grant(extra.toTypedArray()); return }
        val keys = listOfNotNull("camera".takeIf { cam }, "microphone".takeIf { mic })
        val wanted = listOfNotNull(PermissionRequest.RESOURCE_VIDEO_CAPTURE.takeIf { cam }, PermissionRequest.RESOURCE_AUDIO_CAPTURE.takeIf { mic }) + extra
        val proceed = { tab.usedMedia = true; grantMedia(request, wanted) }
        if (keys.all { a.store.sitePermission(origin, it) == "allow" }) { proceed(); return }
        val what = when { cam && mic -> t("ta caméra et ton micro"); cam -> t("ta caméra"); else -> t("ton micro") }
        AlertDialog.Builder(this).setTitle(UrlTools.display(origin)).setMessage(t("Ce site veut utiliser %s.").format(what)).setCancelable(false)
            .setPositiveButton(t("Toujours autoriser")) { _, _ -> keys.forEach { a.store.setSitePermission(origin, it, "allow") }; proceed() }
            .setNeutralButton(t("Cette fois")) { _, _ -> proceed() }
            .setNegativeButton(t("Bloquer")) { _, _ -> keys.forEach { a.store.setSitePermission(origin, it, "block") }; if (extra.isEmpty()) request.deny() else request.grant(extra.toTypedArray()) }
            .show()
    }

    private fun grantMedia(request: PermissionRequest, wanted: List<String>) {
        val needed = ArrayList<String>()
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in wanted && !granted(Manifest.permission.CAMERA)) needed.add(Manifest.permission.CAMERA)
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in wanted && !granted(Manifest.permission.RECORD_AUDIO)) needed.add(Manifest.permission.RECORD_AUDIO)
        if (needed.isEmpty()) { request.grant(wanted.toTypedArray()); return }
        pendingMedia?.first?.deny()
        pendingMedia = request to wanted
        requestPermissions(needed.toTypedArray(), REQ_MEDIA)
    }

    private fun geoRequest(origin0: String, cb: GeolocationPermissions.Callback) {
        val origin = UrlTools.origin(origin0)
        val go = {
            if (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)) cb.invoke(origin0, true, false)
            else { pendingGeo?.second?.invoke(pendingGeo!!.first, false, false); pendingGeo = origin0 to cb; requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_GEO) }
        }
        when (a.store.sitePermission(origin, "geolocation")) {
            "allow" -> go()
            "ask" -> AlertDialog.Builder(this).setTitle(UrlTools.display(origin)).setMessage(t("Ce site veut connaître ta position.")).setCancelable(false)
                .setPositiveButton(t("Autoriser")) { _, _ -> a.store.setSitePermission(origin, "geolocation", "allow"); go() }
                .setNegativeButton(t("Bloquer")) { _, _ -> a.store.setSitePermission(origin, "geolocation", "block"); cb.invoke(origin0, false, false) }.show()
            else -> {
                // Bloquée par défaut : on propose une fois de l'autoriser.
                AlertDialog.Builder(this).setTitle(UrlTools.display(origin)).setMessage(t("Ce site veut connaître ta position.")).setCancelable(false)
                    .setPositiveButton(t("Autoriser")) { _, _ -> a.store.setSitePermission(origin, "geolocation", "allow"); go() }
                    .setNegativeButton(t("Refuser")) { _, _ -> a.store.setSitePermission(origin, "geolocation", "block"); cb.invoke(origin0, false, false) }.show()
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        when (requestCode) {
            REQ_MEDIA -> {
                val (req, wanted) = pendingMedia ?: return; pendingMedia = null
                val ok = wanted.filter { when (it) { PermissionRequest.RESOURCE_VIDEO_CAPTURE -> granted(Manifest.permission.CAMERA); PermissionRequest.RESOURCE_AUDIO_CAPTURE -> granted(Manifest.permission.RECORD_AUDIO); else -> true } }
                if (ok.isEmpty()) req.deny() else req.grant(ok.toTypedArray())
            }
            REQ_GEO -> { val (o, cb) = pendingGeo ?: return; pendingGeo = null; cb.invoke(o, results.any { it == PackageManager.PERMISSION_GRANTED }, false) }
            REQ_STORAGE -> { val f = afterStorage; afterStorage = null; if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) f?.invoke() else toast(t("Téléchargement annulé : accès au stockage refusé.")) }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_FILE -> { fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null }
            REQ_AUTH -> {
                val next = afterAuth; afterAuth = null
                if (resultCode == RESULT_OK) { a.vault.unlockedUntil = System.currentTimeMillis() + 5 * 60_000; next?.invoke() }
            }
            REQ_CSV -> data?.data?.let { importCsv(it) }
        }
    }

    // ======================================================================== Téléchargements
    private fun download(tab: Tab, url: String, ua: String?, cd: String?, mime: String?) {
        if (!UrlTools.isWeb(url)) { toast(t("Ce type de téléchargement n’est pas encore pris en charge.")); return }
        val go = {
            try {
                val name = URLUtil.guessFileName(url, cd, mime)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mime); addRequestHeader("User-Agent", ua ?: mobileUa)
                    if (!tab.private) CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                    setTitle(name); setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                toast(t("Téléchargement de %s…").format(name))
            } catch (e: Exception) { toast(t("Téléchargement impossible.")) }
        }
        if (Build.VERSION.SDK_INT < 29 && !granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) { afterStorage = go; requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE) }
        else go()
    }

    // ======================================================================== Page d'accueil
    private fun greeting(): String {
        val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        return t(if (h >= 18 || h < 4) "Bonsoir" else if (h < 12) "Bonjour" else "Bon après-midi")
    }

    private fun buildHome(tab: Tab): View {
        val scroll = ScrollView(this).apply { isFillViewport = true; setBackgroundColor(if (tab.private) 0xFF150A24.toInt() else C.BG) }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(18), dp(28), dp(18), dp(28)) }
        scroll.addView(col)
        val brand = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        brand.addView(ImageView(this).apply { setImageResource(R.drawable.logo_mark) }, LinearLayout.LayoutParams(dp(46), dp(46)))
        val names = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0) }
        names.addView(text("DevGitBrowser", 22f, bold = true))
        names.addView(text(if (tab.private) t("Onglet privé : rien n’est enregistré") else greeting(), 13f, C.MUTED))
        brand.addView(names)
        col.addView(brand, lp(ViewGroup.LayoutParams.WRAP_CONTENT))

        val search = EditText(this).apply {
            setSingleLine(); hint = t("Rechercher ou saisir une adresse"); setTextColor(C.TEXT); setHintTextColor(C.MUTED); textSize = 16f
            background = rounded(C.SURFACE, dp(16), dp(1), C.LINE); setPadding(dp(18), dp(14), dp(18), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { v, _, _ -> navigate(v.text.toString()); true }
        }
        col.addView(search, lp().margins(t = dp(22), b = dp(6)))
        col.addView(text("🛡 " + t("DevGitShield actif") + "   🔒 " + t("HTTPS prioritaire"), 12f, C.MUTED).apply { gravity = Gravity.CENTER }, lp().margins(b = dp(18)))

        if (tab.private) {
            col.addView(text(t("Les sites que tu visites dans les onglets privés ne sont pas gardés dans l’historique, et leurs cookies sont effacés quand tu fermes le dernier onglet privé. Ton fournisseur d’accès et les sites visités peuvent toujours te voir."), 14f, C.MUTED), lp())
            return scroll
        }

        // Accès rapide : favoris, puis sites les plus visités, puis suggestions.
        val quick = ArrayList<Entry>()
        for (e in a.store.bookmarks.take(4)) quick.add(e)
        for (e in a.store.topSites(12)) if (quick.size < 8 && quick.none { UrlTools.host(it.url) == UrlTools.host(e.url) }) quick.add(e)
        for ((u, n) in listOf("https://www.youtube.com/" to "YouTube", "https://fr.wikipedia.org/" to "Wikipédia", "https://github.com/" to "GitHub", "$HOME_SITE/" to "BabelVisio"))
            if (quick.size < 8 && quick.none { UrlTools.host(it.url) == UrlTools.host(u) }) quick.add(Entry(u, n, 0))
        col.addView(text(t("Accès rapide").uppercase(), 12f, C.MUTED, bold = true), lp().margins(b = dp(8)))
        var row: LinearLayout? = null
        quick.forEachIndexed { i, e ->
            if (i % 4 == 0) { row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }; col.addView(row, lp().margins(b = dp(10))) }
            val tile = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; ripple(dp(14)); setPadding(dp(4), dp(8), dp(4), dp(8)); setOnClickListener { load(tab, e.url) } }
            val name = e.title.ifBlank { UrlTools.display(e.url) }
            tile.addView(text(name.take(1).uppercase(), 18f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; background = rounded(listOf(0xFF6C4CF0, 0xFF0EA5A0, 0xFFE0567A, 0xFF3B82F6, 0xFFF59E0B, 0xFF8B5CF6, 0xFF10B981, 0xFFEC4899)[i % 8].toInt(), dp(14)) }, LinearLayout.LayoutParams(dp(48), dp(48)))
            tile.addView(text(name, 12f, C.TEXT, lines = 1).apply { gravity = Gravity.CENTER }, lp().margins(t = dp(6)))
            row!!.addView(tile, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        while (row != null && row!!.childCount < 4) row!!.addView(View(this), lp(0, 1, 1f))

        col.addView(text(t("Raccourcis").uppercase(), 12f, C.MUTED, bold = true), lp().margins(t = dp(12), b = dp(8)))
        val shortcuts = listOf(t("Favoris") to { showBookmarks() }, t("Historique") to { showHistory() }, t("Mots de passe") to { showPasswords() }, t("Paramètres") to { showSettings() })
        for (pair in shortcuts.chunked(2)) {
            val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEachIndexed { j, (label, fn) -> r.addView(button(label) { fn() }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = if (j == 1) dp(5) else 0, r = if (j == 0) dp(5) else 0)) }
            col.addView(r, lp().margins(b = dp(10)))
        }

        val partner = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        partner.addView(text(t("Partenaire").uppercase(), 11f, C.MUTED, bold = true).apply { background = rounded(Color.TRANSPARENT, dp(10), dp(1), C.LINE); setPadding(dp(8), dp(3), dp(8), dp(3)) })
        partner.addView(View(this), lp(0, 1, 1f)); partner.addView(text("babelvisio.com", 12f, C.MUTED))
        col.addView(partner, lp().margins(t = dp(16), b = dp(8)))
        col.addView(ImageView(this).apply {
            setImageResource(R.drawable.babel_banner); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = t("BabelVisio : discutez, jouez et partagez en direct. Salons live, webcams, jeux et traduction.")
            clipToOutline = true; outlineProvider = object : android.view.ViewOutlineProvider() { override fun getOutline(v: View, o: android.graphics.Outline) { o.setRoundRect(0, 0, v.width, v.height, dp(14).toFloat()) } }
            elevation = dp(8).toFloat(); setOnClickListener { load(tab, HOME_SITE) }
        }, lp().margins(b = dp(12)))
        homeView = scroll
        return scroll
    }

    // ======================================================================== Menu
    private fun showMenu(anchor: View) {
        val tab = active
        val onPage = tab != null && !tab.isHome
        val m = PopupMenu(this, anchor)
        val menu = m.menu
        fun item(id: Int, label: String, visible: Boolean = true) { if (visible) menu.add(0, id, id, label) }
        item(1, t("Recharger"), onPage)
        item(2, t("Page suivante"), onPage && tab!!.web.canGoForward())
        item(3, if (onPage && a.store.isBookmarked(tab!!.url)) t("Retirer des favoris") else t("Ajouter aux favoris"), onPage && !tab!!.private)
        item(4, t("Nouvel onglet")); item(5, t("Nouvel onglet privé"))
        item(6, t("Favoris")); item(7, t("Historique")); item(8, t("Mots de passe"))
        item(9, t("Remplir le mot de passe"), onPage && a.vault.forOrigin(UrlTools.origin(tab!!.url)).isNotEmpty())
        item(10, t("Rechercher dans la page"), onPage); item(11, t("Partager"), onPage)
        item(12, if (tab?.desktop == true) t("Version mobile du site") else t("Version ordinateur du site"), onPage)
        item(17, if (a.tor.state == TorMode.State.OFF || a.tor.state == TorMode.State.ERROR) "🧅 " + t("Mode Tor") else "🧅 " + t("Désactiver le mode Tor"))
        item(15, t("Succès et parrainage")); item(16, t("Signaler un bug"))
        item(13, t("Paramètres")); item(14, t("À propos et mises à jour"))
        m.setOnMenuItemClickListener { mi ->
            when (mi.itemId) {
                1 -> tab?.web?.reload()
                2 -> tab?.web?.goForward()
                3 -> tab?.let { val added = a.store.toggleBookmark(it.url, it.title); a.achievements.atLeast("bookmarks", a.store.bookmarks.size.toLong()); toast(if (added) t("Ajouté aux favoris.") else t("Retiré des favoris.")) }
                4 -> openTab(null)
                5 -> openTab(null, private = true)
                6 -> showBookmarks()
                7 -> showHistory()
                8 -> showPasswords()
                9 -> tab?.let { fillPassword(it) }
                10 -> openFind()
                11 -> tab?.let { startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, it.url), t("Partager"))) }
                12 -> tab?.let { it.desktop = !it.desktop; it.web.settings.userAgentString = if (it.desktop) desktopUa(mobileUa) else mobileUa; it.web.reload() }
                13 -> showSettings()
                14 -> showAbout()
                15 -> showAchievements()
                17 -> toggleTor()
                16 -> reportBug()
            }
            true
        }
        m.show()
    }

    // ======================================================================== Écrans : favoris, historique
    private fun showBookmarks() {
        val s = Screen(this, t("Favoris"), overlay, screens).show()
        fun fill() {
            s.body.removeAllViews()
            if (a.store.bookmarks.isEmpty()) { s.empty(t("Aucun favori. Menu ⋮ → « Ajouter aux favoris » sur une page.")); return }
            s.note(t("Appui long pour supprimer."))
            for (e in a.store.bookmarks.toList()) s.row(e.title.ifBlank { UrlTools.display(e.url) }, UrlTools.display(e.url),
                onClick = { s.close(); active?.let { load(it, e.url) } ?: openTab(e.url) },
                onLong = { confirm(t("Supprimer ce favori ?"), e.title) { a.store.removeBookmark(e); fill() } })
        }
        fill()
    }

    private fun showHistory() {
        val s = Screen(this, t("Historique"), overlay, screens).show()
        val filter = EditText(this).apply { setSingleLine(); hint = t("Rechercher dans l’historique"); setTextColor(C.TEXT); setHintTextColor(C.MUTED); background = rounded(C.SURFACE, dp(12)); setPadding(dp(12), dp(10), dp(12), dp(10)) }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        s.body.addView(filter, lp().margins(t = dp(8), b = dp(8)))
        s.body.addView(button(t("Effacer l’historique")) { confirm(t("Effacer tout l’historique ?"), null) { a.store.clearHistory(); s.close() } }, lp().margins(b = dp(10)))
        s.body.addView(list, lp())
        val fmt = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT)
        fun fill() {
            list.removeAllViews()
            val q = filter.text.toString().trim().lowercase()
            val items = a.store.history.asSequence().filter { q.isEmpty() || it.url.lowercase().contains(q) || it.title.lowercase().contains(q) }.take(300).toList()
            if (items.isEmpty()) { list.addView(text(t("Rien ici."), 14f, C.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(30), 0, dp(30)) }, lp()); return }
            val tmp = Screen(this, "", FrameLayout(this), ArrayList())
            for (e in items) {
                val r = tmp.row(e.title.ifBlank { UrlTools.display(e.url) }, UrlTools.display(e.url) + " · " + fmt.format(java.util.Date(e.at)),
                    onClick = { s.close(); active?.let { load(it, e.url) } ?: openTab(e.url) },
                    onLong = { confirm(t("Retirer de l’historique ?"), e.title) { a.store.removeHistory(e); fill() } })
                tmp.body.removeView(r); list.addView(r, lp().margins(b = dp(6)))
            }
        }
        filter.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(x: android.text.Editable?) { fill() }
            override fun beforeTextChanged(x: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(x: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        fill()
    }

    private fun confirm(title: String, detail: String?, ok: () -> Unit) {
        AlertDialog.Builder(this).setTitle(title).setMessage(detail).setPositiveButton(t("Confirmer")) { _, _ -> ok() }.setNegativeButton(t("Annuler"), null).show()
    }

    // ======================================================================== Mots de passe
    private fun requireUnlock(then: () -> Unit) {
        if (a.vault.unlocked) { then(); return }
        val km = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        val intent = if (km.isDeviceSecure) km.createConfirmDeviceCredentialIntent(t("Mots de passe"), t("Confirme ton identité pour afficher tes mots de passe.")) else null
        if (intent == null) {
            AlertDialog.Builder(this).setTitle(t("Mots de passe")).setMessage(t("Ton téléphone n’a pas de verrouillage d’écran : tes mots de passe ne sont pas protégés si quelqu’un l’utilise. Active un code ou une empreinte dans les réglages d’Android."))
                .setPositiveButton(t("Continuer")) { _, _ -> a.vault.unlockedUntil = System.currentTimeMillis() + 5 * 60_000; then() }.setNegativeButton(t("Annuler"), null).show()
            return
        }
        afterAuth = then
        startActivityForResult(intent, REQ_AUTH)
    }

    private fun showPasswords() = requireUnlock {
        val s = Screen(this, t("Mots de passe"), overlay, screens).show()
        fun fill() {
            s.body.removeAllViews()
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(button(t("Importer (CSV)"), primary = true) { pickCsv() }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(r = dp(5)))
            actions.addView(button(t("Ajouter")) { editPassword(null) { fill() } }, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = dp(5)))
            s.body.addView(actions, lp().margins(t = dp(8), b = dp(6)))
            s.note(t("Chiffrés avec la clé de sécurité de ton téléphone. Import depuis l’export officiel de Chrome, Edge, Firefox, Brave ou Bitwarden."))
            if (a.vault.entries.isEmpty()) { s.empty(t("Aucun mot de passe enregistré.")); return }
            for (e in a.vault.entries.toList()) s.row(UrlTools.display(e.origin), e.username.ifBlank { t("(sans identifiant)") }, onClick = { passwordActions(e) { fill() } })
        }
        fill()
        passwordsRefresh = { fill() }
    }
    private var passwordsRefresh: (() -> Unit)? = null

    private fun passwordActions(e: Credential, done: () -> Unit) {
        val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        val opts = arrayOf(t("Copier l’identifiant"), t("Copier le mot de passe"), t("Afficher le mot de passe"), t("Ouvrir le site"), t("Modifier"), t("Supprimer"))
        AlertDialog.Builder(this).setTitle(UrlTools.display(e.origin)).setItems(opts) { _, i ->
            when (i) {
                0 -> { cm.setPrimaryClip(ClipData.newPlainText("login", e.username)); toast(t("Copié.")) }
                1 -> { cm.setPrimaryClip(ClipData.newPlainText("password", e.password).apply {
                        if (Build.VERSION.SDK_INT >= 24) description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) } })
                       toast(t("Mot de passe copié.")) }
                2 -> AlertDialog.Builder(this).setTitle(e.username).setMessage(e.password).setPositiveButton("OK", null).show()
                3 -> { screens.toList().forEach { it.close() }; active?.let { load(it, e.origin) } ?: openTab(e.origin) }
                4 -> editPassword(e, done)
                5 -> confirm(t("Supprimer ce mot de passe ?"), UrlTools.display(e.origin)) { a.vault.remove(e); done() }
            }
        }.show()
    }

    private fun editPassword(e: Credential?, done: () -> Unit) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        fun field(hint: String, value: String, pass: Boolean = false) = EditText(this).apply { this.hint = hint; setText(value); setSingleLine(); if (pass) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }.also { box.addView(it, lp()) }
        val site = field(t("Site (ex. https://exemple.fr)"), e?.origin ?: active?.url?.let { UrlTools.origin(it) } ?: "")
        val user = field(t("Identifiant"), e?.username ?: "")
        val pass = field(t("Mot de passe"), e?.password ?: "", true)
        AlertDialog.Builder(this).setTitle(if (e == null) t("Ajouter un mot de passe") else t("Modifier")).setView(box)
            .setPositiveButton(t("Enregistrer")) { _, _ ->
                val origin = UrlTools.origin(site.text.toString().trim().let { if (UrlTools.isWeb(it)) it else "https://$it" })
                if (origin.isEmpty() || pass.text.isEmpty()) { toast(t("Site ou mot de passe manquant.")); return@setPositiveButton }
                if (e != null) a.vault.remove(e)
                a.vault.add(listOf(Credential(origin, user.text.toString(), pass.text.toString())))
                a.achievements.atLeast("vaultCreated", 1); a.achievements.atLeast("passwords", a.vault.entries.size.toLong()); done()
            }.setNegativeButton(t("Annuler"), null).show()
    }

    private fun pickCsv() {
        try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel")), REQ_CSV) }
        catch (_: Exception) { toast(t("Impossible d’ouvrir le sélecteur de fichiers.")) }
    }

    private fun importCsv(uri: Uri) {
        try {
            val text = contentResolver.openInputStream(uri)?.use { it.readBytes() }?.let { if (it.size > 5_000_000) null else String(it, Charsets.UTF_8) }
            val list = PasswordImport.fromCsv(text ?: "")
            if (list.isEmpty()) { toast(t("Aucun mot de passe trouvé dans ce fichier. Utilise l’export CSV officiel de ton ancien navigateur.")); return }
            val n = a.vault.add(list)
            a.achievements.bump("imports"); a.achievements.atLeast("vaultCreated", 1); a.achievements.atLeast("passwords", a.vault.entries.size.toLong())
            AlertDialog.Builder(this).setTitle(t("Import terminé")).setMessage(t("%d mots de passe importés. Supprime maintenant le fichier CSV : il contient tes mots de passe en clair.").format(n)).setPositiveButton("OK", null).show()
            passwordsRefresh?.invoke()
        } catch (e: Exception) { toast(t("Import impossible.")) }
    }

    /** Remplit identifiant et mot de passe dans la page (valeurs passées en JSON, jamais interprétées comme du code). */
    private fun fillPassword(tab: Tab) = requireUnlock {
        val list = a.vault.forOrigin(UrlTools.origin(tab.url))
        if (list.isEmpty()) return@requireUnlock
        val pick = { e: Credential ->
            val js = """(function(u,p){var pw=[].slice.call(document.querySelectorAll('input[type=password]')).filter(function(x){return x.offsetParent!==null});
var f=pw[0];if(!f)return 'none';var form=f.form||document;var us=[].slice.call(form.querySelectorAll('input[type=email],input[type=text],input[autocomplete=username],input:not([type])')).filter(function(x){return x.offsetParent!==null&&x!==f});
function set(el,v){var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
if(us.length&&u)set(us[us.length-1],u);set(f,p);return 'ok';})(${JSONObject.quote(e.username)},${JSONObject.quote(e.password)})"""
            tab.web.evaluateJavascript(js) { r -> if (r?.contains("none") == true) toast(t("Aucun champ de mot de passe sur cette page.")) }
        }
        if (list.size == 1) pick(list[0])
        else AlertDialog.Builder(this).setTitle(t("Quel compte ?")).setItems(list.map { it.username.ifBlank { t("(sans identifiant)") } }.toTypedArray()) { _, i -> pick(list[i]) }.show()
    }

    // ======================================================================== Infos du site
    private fun showSiteInfo() {
        val tab = active ?: return
        if (tab.isHome) return
        val origin = UrlTools.origin(tab.url); val host = UrlTools.host(tab.url)
        val s = Screen(this, UrlTools.display(origin), overlay, screens).show()
        s.note(if (tab.url.startsWith("https://")) "🔒 " + t("Connexion chiffrée (HTTPS).") else "⚠️ " + t("Connexion non chiffrée : n’entre pas de mot de passe ni de données bancaires."))
        s.section("DevGitShield")
        s.switch(t("Bloquer les pubs et traqueurs sur ce site"), t("%d éléments bloqués sur cette page").format(tab.blocked), !a.store.shieldAllowed(host)) { on ->
            a.store.setShieldAllowed(host, !on); tab.web.reload()
        }
        s.section(t("Autorisations"))
        val labels = mapOf("ask" to t("Demander"), "allow" to t("Autoriser"), "block" to t("Bloquer"))
        fun choice(key: String, title: String, modes: List<String>, sub: String? = null) {
            var r: LinearLayout? = null
            r = s.row(title, (sub?.let { "$it\n" } ?: "") + labels[a.store.sitePermission(origin, key)], onClick = {
                val cur = modes.indexOf(a.store.sitePermission(origin, key))
                AlertDialog.Builder(this).setTitle(title).setSingleChoiceItems(modes.map { labels[it] }.toTypedArray(), cur) { d, i ->
                    a.store.setSitePermission(origin, key, modes[i]); d.dismiss()
                    if (key == "insecure") tab.web.reload()
                    ((r!!.getChildAt(0) as LinearLayout).getChildAt(1) as? TextView)?.text = (sub?.let { "$it\n" } ?: "") + labels[modes[i]]
                }.show()
            })
        }
        choice("camera", t("Caméra"), listOf("ask", "allow", "block"))
        choice("microphone", t("Microphone"), listOf("ask", "allow", "block"))
        choice("geolocation", t("Position géographique"), listOf("ask", "allow", "block"))
        choice("insecure", t("Contenu non chiffré (http)"), listOf("block", "allow"), t("À autoriser seulement pour un site de confiance qui lit des vidéos ou flux en http."))
        s.body.addView(button(t("Réinitialiser les autorisations du site")) { a.store.resetSite(origin); a.store.setShieldAllowed(host, false); s.close(); tab.web.reload() }, lp().margins(t = dp(14)))
    }

    // ======================================================================== Paramètres
    private fun showSettings() {
        val s = Screen(this, t("Paramètres"), overlay, screens).show()
        s.section(t("Général"))
        val eng = UrlTools.engines
        s.row(t("Moteur de recherche"), eng[a.prefs.engine]?.first, onClick = {
            val keys = eng.keys.toList()
            AlertDialog.Builder(this).setTitle(t("Moteur de recherche")).setSingleChoiceItems(keys.map { eng[it]!!.first }.toTypedArray(), keys.indexOf(a.prefs.engine)) { d, i -> a.prefs.engine = keys[i]; d.dismiss(); s.close(); showSettings() }.show()
        })
        val langs = listOf("auto" to t("Automatique"), "fr" to "Français", "en" to "English")
        s.row(t("Langue"), langs.firstOrNull { it.first == a.prefs.language }?.second, onClick = {
            AlertDialog.Builder(this).setTitle(t("Langue")).setSingleChoiceItems(langs.map { it.second }.toTypedArray(), langs.indexOfFirst { it.first == a.prefs.language }) { d, i ->
                a.prefs.language = langs[i].first; L.init(this, a.prefs.language); d.dismiss(); recreate()
            }.show()
        })
        s.row(t("Navigateur par défaut"), t("Ouvrir les liens des autres applications avec DevGitBrowser"), onClick = {
            try { startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_SETTINGS)) }
        })
        s.section(t("Sécurité"))
        s.switch("DevGitShield", t("Bloque publicités et traqueurs (listes EasyList, EasyPrivacy, Peter Lowe, Liste FR). %d domaines.").format(a.shield.adRules), a.prefs.shield) { a.prefs.shield = it }
        s.switch(t("Protection anti-hameçonnage"), t("Avertit avant d’ouvrir un site dangereux connu (%d domaines). Vérification locale.").format(a.shield.dangerRules), a.prefs.phishing) { a.prefs.phishing = it }
        s.switch(t("HTTPS prioritaire"), t("Ouvre les sites en connexion chiffrée quand c’est possible."), a.prefs.httpsFirst) { a.prefs.httpsFirst = it }
        s.row(t("Mettre à jour les listes de protection"), null, onClick = { toast(t("Mise à jour des listes…")); Thread { a.shield.refresh(true); ui.post { toast(t("Listes de protection à jour.")) } }.start() })
        val sites = a.store.customSites()
        if (sites.isNotEmpty()) {
            s.section(t("Sites avec des autorisations"))
            for (o in sites) s.row(UrlTools.display(o), t("Appui long pour réinitialiser"), onLong = { confirm(t("Réinitialiser les autorisations ?"), UrlTools.display(o)) { a.store.resetSite(o); s.close(); showSettings() } })
        }
        s.section(t("Confidentialité"))
        s.switch(t("Statistiques anonymes"), t("Version, pays du téléphone, temps d’utilisation et nombre de pages. Jamais les sites visités ni ton adresse IP."), a.prefs.telemetry == 1) { a.prefs.telemetry = if (it) 1 else 0; refreshBanners() }
        s.row(t("Effacer les données de navigation"), t("Historique, cookies, cache et données des sites"), onClick = {
            confirm(t("Effacer les données de navigation ?"), t("Tu seras déconnecté des sites. Favoris et mots de passe sont conservés.")) {
                a.store.clearHistory(); CookieManager.getInstance().removeAllCookies(null); android.webkit.WebStorage.getInstance().deleteAllData()
                for (tb in tabs) { tb.web.clearCache(true); tb.web.clearHistory() }
                toast(t("Données de navigation effacées."))
            }
        })
        s.row(t("Supprimer tous les mots de passe"), null, onClick = { requireUnlock { confirm(t("Supprimer tous les mots de passe ?"), t("Cette action est définitive.")) { a.vault.clear(); toast(t("Mots de passe supprimés.")) } } })
    }

    private fun showAbout() {
        val s = Screen(this, t("À propos"), overlay, screens).show()
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(14), 0, dp(10)) }
        head.addView(ImageView(this).apply { setImageResource(R.drawable.logo_mark) }, LinearLayout.LayoutParams(dp(54), dp(54)))
        val n = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, 0, 0) }
        n.addView(text("DevGitBrowser", 20f, bold = true))
        n.addView(text("Android v" + BuildConfig.VERSION_NAME + (if (BuildConfig.CHANNEL.isNotEmpty()) " · " + BuildConfig.CHANNEL else ""), 13f, C.MUTED))
        n.addView(text("CodexHempreur INC", 12f, C.MUTED))
        head.addView(n); s.body.addView(head, lp())
        if (BuildConfig.SELF_UPDATE) {
        val status = s.row(t("Rechercher une mise à jour"), a.updater.available?.let { t("Version %s disponible").format(it.version) } ?: t("Vérifie si une nouvelle version est publiée"))
        status.setOnClickListener {
            ((status.getChildAt(0) as LinearLayout).getChildAt(1) as? TextView)?.text = t("Vérification…")
            a.updater.check { rel, err ->
                ((status.getChildAt(0) as LinearLayout).getChildAt(1) as? TextView)?.text = when { err != null -> t("Impossible de vérifier : %s").format(err); rel != null -> t("Version %s disponible").format(rel.version); else -> t("Tu as la dernière version.") }
                if (rel != null) { a.prefs.skippedUpdate = ""; refreshBanners() }
            }
        }
        } else s.note(t("Les mises à jour sont installées par Google Play."))
        for (c in a.server.chats()) {
            val id = c.optString("bugId")
            s.row("💬 " + t("Discussion de support"), c.optString("subject").take(80), onClick = {
                val v = lastSupport[id]
                if (v != null) showSupportChat(v) else { a.server.reloadChat(id); toast(t("Ouverture de la discussion… (quelques secondes)")) }
            })
        }
        s.row(t("Signaler un bug"), t("Le rapport part chez le créateur de DevGitBrowser"), onClick = { reportBug() })
        s.row(t("Site officiel"), "hempreur.github.io/DevGitBrowser", onClick = { s.close(); openTab("https://hempreur.github.io/DevGitBrowser/") })
        s.row("Discord", t("Rejoindre la communauté"), onClick = { s.close(); openTab("https://discord.gg/hmQZuDXBvu") })
        s.row("GitHub", "github.com/hempreur/DevGitBrowser", onClick = { s.close(); openTab("https://github.com/hempreur/DevGitBrowser") })
        s.note(t("Moteur : Android System WebView (Chromium), mis à jour par Google."))
    }

    // ======================================================================== Bandeaux : messages, mises à jour, contenu http, statistiques
    private fun banner(icon: String, msg: String, color: Int, actions: List<Pair<String, () -> Unit>>, onClose: (() -> Unit)?) {
        val b = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(color); setPadding(dp(12), dp(8), dp(6), dp(8)) }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(text("$icon  $msg", 13.5f), lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (onClose != null) top.addView(text("✕", 16f, C.MUTED).apply { gravity = Gravity.CENTER; ripple(dp(16)); setOnClickListener { onClose() } }, LinearLayout.LayoutParams(dp(36), dp(36)))
        b.addView(top)
        if (actions.isNotEmpty()) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
            actions.forEachIndexed { i, (label, fn) -> row.addView(button(label, primary = i == 0) { fn() }.apply { setPadding(dp(12), dp(6), dp(12), dp(6)) }, lp(ViewGroup.LayoutParams.WRAP_CONTENT).margins(l = dp(8), r = dp(6))) }
            b.addView(row, lp().margins(t = dp(4)))
        }
        banners.addView(b, lp())
    }

    private var bannerKey = "-"
    /** Bandeaux reconstruits seulement quand leur contenu change (pas à chaque étape du chargement). */
    private fun refreshBanners() {
        if (!::banners.isInitialized) return
        val m = shownMessages.values.lastOrNull { it.id.toString() !in a.prefs.dismissed }
        val rel0 = a.updater.available; val c0 = active
        val key = listOf(a.tor.state, lockView != null, m?.id, rel0?.version, a.prefs.skippedUpdate, updateProgress, c0?.id, c0?.mixedBlocked, c0?.mixedDismissed, c0?.url?.startsWith("https://"), a.prefs.telemetry, L.en).joinToString("|")
        if (key == bannerKey) return
        bannerKey = key
        banners.removeAllViews()
        if (lockView != null) return
        when (a.tor.state) {
            TorMode.State.STARTING -> banner("🧅", t("Connexion au réseau Tor… (jusqu’à 1 minute)"), 0xFF2D1B4E.toInt(), emptyList()) { a.tor.stop() }
            TorMode.State.ON -> banner("🧅", t("Mode Tor actif : les sites ne voient pas ton adresse IP. Seuls les sites HTTPS s’ouvrent ; les appels vidéo sont désactivés."), 0xFF2D1B4E.toInt(), emptyList(), null)
            TorMode.State.ERROR -> banner("🧅", a.tor.error, 0xFF4A1020.toInt(), listOf(t("Réessayer") to { a.tor.start(); Unit })) { a.tor.stop(); refreshBanners() }
            else -> {}
        }
        if (m != null) banner(if (m.level == "alert") "⚠️" else "📣", m.text, if (m.level == "alert") 0xFF4A3410.toInt() else 0xFF1E1A45.toInt(),
            if (m.url.isNotEmpty()) listOf(t("En savoir plus") to { openTab(m.url); Unit }) else emptyList()) { a.prefs.dismissed = a.prefs.dismissed + m.id.toString(); refreshBanners() }
        val rel = a.updater.available
        if (rel != null && rel.version != a.prefs.skippedUpdate) {
            val msg = if (updateProgress >= 0) t("Téléchargement de la version %s… %d %%").format(rel.version, updateProgress) else t("DevGitBrowser %s est disponible.").format(rel.version)
            banner("⬆️", msg, 0xFF14284A.toInt(), if (updateProgress >= 0) emptyList() else listOf(t("Installer") to { installUpdate(rel) }, t("Plus tard") to { a.prefs.skippedUpdate = rel.version; refreshBanners() }), null)
        }
        val cur = active
        if (cur != null && cur.mixedBlocked && !cur.mixedDismissed && cur.url.startsWith("https://"))
            banner("🔓", t("Ce site essaie de charger du contenu non chiffré (http), par exemple un flux vidéo. Il est bloqué par sécurité. L’autoriser pour ce site ?"), 0xFF2A1F45.toInt(),
                listOf(t("Autoriser pour ce site") to { a.store.setSitePermission(UrlTools.origin(cur.url), "insecure", "allow"); cur.mixedBlocked = false; applyMixedMode(cur, cur.url); cur.web.reload(); refreshBanners() },
                    t("Ignorer") to { cur.mixedDismissed = true; refreshBanners() }), null)
        if (a.prefs.telemetry == -1 && a.server.available)
            banner("📊", t("Aider à améliorer DevGitBrowser ? Envoi de statistiques anonymes : version, pays du téléphone, temps d’utilisation et nombre de pages. Jamais les sites visités, ni ton adresse IP."), 0xFF17132F.toInt(),
                listOf(t("Oui, j’aide") to { a.prefs.telemetry = 1; askNotifications(); refreshBanners() }, t("Non merci") to { a.prefs.telemetry = 0; askNotifications(); refreshBanners() }), null)
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !a.prefs.notifAsked && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            a.prefs.notifAsked = true; requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    private fun createChannels() = Notifier.channels(this)

    private fun notifyUser(channel: String, id: Int, title: String, body: String) = Notifier.show(this, channel, id, title, body)

    // ======================================================================== Serveur : messages, arrêt d'urgence
    private fun wireServer() {
        val s = a.server
        s.onMessage = { m ->
            shownMessages[m.id] = m; while (shownMessages.size > 10) shownMessages.remove(shownMessages.keys.first())
            refreshBanners()
            if (!resumed) notifyUser("messages", (m.id % 100000).toInt(), if (m.level == "alert") "⚠️ DevGitBrowser" else "📣 DevGitBrowser", m.text)
        }
        s.onRetract = { ids -> ids.forEach { shownMessages.remove(it) }; refreshBanners() }
        // Téléphone admin (jeton du serveur enregistré) : jamais bloqué, mais prévenu.
        s.onLockdown = { l -> if (l.blocked && a.admin.hasToken) toast(t("Arrêt d’urgence actif : ce téléphone admin reste accessible.")) else if (l.blocked) engageLock(l) else liftLock() }
        s.onSupport = { v -> onSupport(v) }
        s.onLatest = { v -> if (Versions.newer(v, BuildConfig.VERSION_NAME)) checkUpdates(silent = true) }
        s.start()
    }

    private fun onSupport(v: SupportView) {
        lastSupport[v.bugId] = v
        val view = chatViews[v.bugId]
        if (view != null) view(v) else if (v.open && lockView == null) showSupportChat(v)
        val last = v.messages.lastOrNull { it.from != "system" }
        if (!resumed && last?.from == "admin") Notifier.show(this, "support", 9000 + v.bugId.hashCode() % 1000, t("💬 Réponse du support DevGitBrowser"), last.text.take(200), "support:" + v.bugId)
    }

    private fun toggleTor() {
        if (a.tor.state == TorMode.State.ON || a.tor.state == TorMode.State.STARTING) { a.tor.stop(); for (tb in tabs) if (!tb.isHome) tb.web.reload(); return }
        AlertDialog.Builder(this).setTitle("🧅 " + t("Mode Tor"))
            .setMessage(t("Toutes les pages passeront par le réseau Tor : les sites ne verront pas ton adresse IP. C’est plus lent, seuls les sites HTTPS s’ouvrent, et les appels vidéo (WebRTC) sont désactivés pour ne pas révéler ton adresse. Pour un anonymat maximal, utilise Tor Browser."))
            .setNegativeButton(t("Annuler"), null)
            .setPositiveButton(t("Activer")) { _, _ ->
                a.tor.start(); for (tb in tabs) a.tor.protect(tb.web)
                // Rien ne se charge en direct pendant la connexion : les pages repartent une fois Tor prêt.
                for (tb in tabs) if (!tb.isHome && UrlTools.isWeb(tb.url)) { tb.pending = tb.url; tb.web.stopLoading(); tb.web.loadUrl("about:blank") }
            }.show()
    }

    /** Arrêt d'urgence décidé par l'éditeur : tout est bloqué, même après redémarrage, jusqu'au déblocage. */
    private fun engageLock(l: Lockdown) {
        if (lockView == null) {
            saveTabs()
            screens.toList().forEach { it.close() }; exitFullscreen()
            for (t in tabs) destroyWeb(t.web)
            tabs.clear(); active = null; content.removeAllViews()
            val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(0xFF0B0A18.toInt()); isClickable = true; setPadding(dp(24), dp(24), dp(24), dp(24)) }
            v.addView(ImageView(this).apply { setImageResource(R.drawable.logo_mark) }, LinearLayout.LayoutParams(dp(72), dp(72)))
            v.addView(text("⛔ " + t("DevGitBrowser est temporairement indisponible"), 20f, bold = true).apply { gravity = Gravity.CENTER }, lp().margins(t = dp(18)))
            v.addView(text("", 15f, C.MUTED).apply { gravity = Gravity.CENTER; tag = "msg" }, lp().margins(t = dp(10)))
            v.addView(text(t("L’éditeur a suspendu le navigateur. Il se débloquera tout seul dès que l’accès sera rétabli."), 13f, C.MUTED).apply { gravity = Gravity.CENTER }, lp().margins(t = dp(10), b = dp(18)))
            v.addView(button(t("Quitter")) { finishAndRemoveTask() }, lp(ViewGroup.LayoutParams.WRAP_CONTENT))
            lockView = v
            root.addView(v, FrameLayout.LayoutParams(-1, -1))
            refreshBanners(); root.requestApplyInsets()
        }
        (lockView as ViewGroup).findViewWithTag<TextView>("msg")?.text = l.message.ifBlank { t("Accès suspendu par l’éditeur.") }
    }

    private fun liftLock() {
        val v = lockView ?: return
        root.removeView(v); lockView = null
        restoreTabs(); if (tabs.isEmpty()) openTab(null)
        refreshBanners(); toast(t("DevGitBrowser est de nouveau disponible."))
    }

    // ======================================================================== Mises à jour
    private fun checkUpdates(silent: Boolean) {
        a.updater.check { rel, _ ->
            if (rel != null) {
                refreshBanners()
                if (!resumed && silent) notifyUser("updates", 7, t("Mise à jour disponible"), t("DevGitBrowser %s est disponible.").format(rel.version))
            }
        }
    }

    private fun installUpdate(rel: Release) {
        if (!packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(this).setTitle(t("Autorisation nécessaire"))
                .setMessage(t("Pour installer la mise à jour, autorise DevGitBrowser à installer des applications (une seule fois), puis reviens et appuie de nouveau sur « Installer »."))
                .setPositiveButton(t("Ouvrir les réglages")) { _, _ -> try { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) } catch (_: Exception) {} }
                .setNegativeButton(t("Annuler"), null).show()
            return
        }
        updateProgress = 0; refreshBanners()
        a.updater.download(rel, { p -> updateProgress = p; refreshBanners() }) { file, err ->
            updateProgress = -1; refreshBanners()
            if (file == null) { toast(t("Téléchargement de la mise à jour impossible : %s").format(err ?: "")); return@download }
            saveTabs()
            try { a.updater.install(file) } catch (e: Exception) { toast(t("Installation impossible : %s").format(e.message ?: "")) }
        }
    }
}
