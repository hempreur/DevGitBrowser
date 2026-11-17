package inc.codexhempreur.devgitbrowser

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * MatchPulse sur Android : les fichiers de l'extension (core.js, dom-reader.js, content.js, background.js, style.css)
 * sont repris tels quels. Le panneau est injecté uniquement sur Betclic, Winamax et Unibet ; le module de données
 * tourne dans une page cachée, démarrée à l'ouverture d'un site de paris et arrêtée 5 min après le dernier onglet.
 */
class MatchPulse(private val ctx: Context, private val host: ViewGroup) {
    companion object {
        val DOMAINS = listOf("betclic.fr", "winamax.fr", "unibet.fr", "unibet.be", "unibetsports.be")
        private val RULES: Set<String> = DOMAINS.flatMap { d -> listOf("https://$d", "https://*.$d") }.toSet()
        private val DATA_HOSTS = setOf("site.api.espn.com", "v3.football.api-sports.io")
        fun isBookmaker(host: String) = DOMAINS.any { host == it || host.endsWith(".$it") }
    }

    private val main = Handler(Looper.getMainLooper())
    val supported: Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    } catch (_: Throwable) { false }

    private fun asset(name: String) = ctx.assets.open("matchpulse/$name").bufferedReader().use { it.readText() }
    private val pageScript: String by lazy {
        val css = JSONObject.quote(asset("style.css"))
        """(function(){if(window.top!==window||window.__dgbMatchPulse)return;window.__dgbMatchPulse=true;var port=window.DGBMatchPulse;if(!port)return;
var seq=0,waiting={};port.onmessage=function(ev){try{var d=JSON.parse(ev.data);var cb=waiting[d.id];if(cb){delete waiting[d.id];cb(d.response);}}catch(e){}};
var chrome={runtime:{lastError:undefined,sendMessage:function(msg,cb){var id=++seq;waiting[id]=cb||function(){};port.postMessage(JSON.stringify({id:id,msg:msg}));}}};
function run(){var st=document.createElement('style');st.textContent=$css;(document.head||document.documentElement).appendChild(st);
(function(chrome){
${asset("core.js")}
${asset("dom-reader.js")}
${asset("content.js")}
})(chrome);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();})();"""
    }

    private val engineShim = """(function(){var listeners=[],fetchWait={},fseq=0;
window.chrome={runtime:{onMessage:{addListener:function(f){listeners.push(f);}}}};
window.__mpDispatch=function(rid,msg,url){var done=false;function send(r){if(done)return;done=true;MPNative.reply(rid,JSON.stringify(r));}
for(var i=0;i<listeners.length;i++){try{listeners[i](msg,{url:url},send);}catch(e){send({ok:false,error:String(e&&e.message||e)});}}};
window.fetch=function(url,opts){var id=++fseq;return new Promise(function(res,rej){fetchWait[id]={res:res,rej:rej};MPNative.fetch(id,String(url),JSON.stringify((opts&&opts.headers)||{}));});};
window.__mpFetchDone=function(id,status,body,err){var w=fetchWait[id];if(!w)return;delete fetchWait[id];if(err){w.rej(new TypeError(err));return;}
w.res({ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve(JSON.parse(body));},text:function(){return Promise.resolve(body);}});};
window.Notification=function(t,o){MPNative.notify(String(t),String((o&&o.body)||''));};window.Notification.permission='granted';
window.Notification.requestPermission=function(){return Promise.resolve('granted');};})();"""

    private var engine: WebView? = null
    private var engineReady = false
    private val queue = ArrayList<String>()
    private val replies = ConcurrentHashMap<String, Pair<JavaScriptReplyProxy, Long>>()
    private var rseq = 0L
    @Volatile private var busy = false
    private var idleSince = 0L
    val running get() = engine != null

    /** À appeler pour chaque nouvelle vue d'onglet (avant tout chargement). */
    fun install(web: WebView) {
        if (!supported) return
        try {
            WebViewCompat.addDocumentStartJavaScript(web, pageScript, RULES)
            WebViewCompat.addWebMessageListener(web, "DGBMatchPulse", RULES) { _, message, origin, isMainFrame, reply ->
                val data = message.data ?: return@addWebMessageListener
                if (!isMainFrame || !isBookmaker(UrlTools.host(origin.toString()))) return@addWebMessageListener
                fromPage(data, origin.toString(), reply)
            }
        } catch (_: Exception) {}
    }

    private fun fromPage(data: String, origin: String, reply: JavaScriptReplyProxy) {
        val o = try { JSONObject(data) } catch (_: Exception) { return }
        val rid = "r" + (++rseq)
        replies[rid] = reply to o.optLong("id")
        val call = "__mpDispatch(${JSONObject.quote(rid)},${o.optJSONObject("msg") ?: JSONObject()},${JSONObject.quote("$origin/")})"
        ensureEngine()
        if (engineReady) engine?.evaluateJavascript(call, null) else queue.add(call)
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun ensureEngine() {
        if (engine != null) return
        val w = WebView(ctx)
        w.settings.javaScriptEnabled = true
        w.settings.allowFileAccess = false; w.settings.allowContentAccess = false
        w.addJavascriptInterface(Bridge(), "MPNative")
        w.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                engineReady = true; for (c in queue) view.evaluateJavascript(c, null); queue.clear()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest) = true
        }
        // Vue invisible de 1 px : les minuteries JavaScript continuent de tourner.
        host.addView(w, FrameLayout.LayoutParams(1, 1)); w.alpha = 0f; w.visibility = View.VISIBLE
        val html = "<!doctype html><meta charset=utf-8><script>$engineShim</script><script>${asset("core.js")}</script><script>${asset("background.js")}</script>"
        w.loadDataWithBaseURL("https://matchpulse.devgit/", html, "text/html", "utf-8", null)
        engine = w
    }

    /** Arrête le module 5 min après la fermeture du dernier onglet de paris, sauf si des matchs sont suivis. */
    fun reap(bookmakerOpen: Boolean) {
        val w = engine ?: return
        if (bookmakerOpen) { idleSince = 0; return }
        w.evaluateJavascript("Boolean(globalThis.MatchPulseBusy&&MatchPulseBusy())") { busy = it == "true" }
        if (busy) { idleSince = 0; return }
        if (idleSince == 0L) { idleSince = System.currentTimeMillis(); return }
        if (System.currentTimeMillis() - idleSince < 5 * 60_000) return
        host.removeView(w); w.destroy(); engine = null; engineReady = false; queue.clear(); replies.clear(); idleSince = 0
    }

    private inner class Bridge {
        @JavascriptInterface fun reply(rid: String, json: String) {
            main.post {
                val (proxy, pageId) = replies.remove(rid) ?: return@post
                try { proxy.postMessage(JSONObject().put("id", pageId).put("response", JSONObject(json)).toString()) } catch (_: Exception) {}
            }
        }

        @JavascriptInterface fun fetch(id: Int, url: String, headers: String) {
            Thread {
                var status = 0; var body = ""; var err: String? = null
                try {
                    val u = URL(url)
                    if (u.protocol != "https" || u.host !in DATA_HOSTS) throw IllegalStateException("Source non autorisée.")
                    val c = u.openConnection() as HttpURLConnection
                    c.connectTimeout = 15_000; c.readTimeout = 15_000; c.useCaches = false
                    try { val h = JSONObject(headers); for (k in h.keys()) if (k.lowercase() in setOf("x-apisports-key", "accept")) c.setRequestProperty(k, h.getString(k)) } catch (_: Exception) {}
                    status = c.responseCode
                    body = (if (status in 200..399) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }?.take(3_000_000) ?: ""
                    c.disconnect()
                } catch (e: Exception) { err = e.message ?: "réseau" }
                val call = "__mpFetchDone($id,$status,${JSONObject.quote(body)},${if (err == null) "null" else JSONObject.quote(err)})"
                main.post { engine?.evaluateJavascript(call, null) }
            }.start()
        }

        @JavascriptInterface fun notify(title: String, body: String) {
            Notifier.show(ctx, "matchpulse", 5000 + (title.hashCode() and 0xfff), title.take(80), body.take(300))
        }
    }
}
