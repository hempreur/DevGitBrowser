package inc.codexhempreur.devgitbrowser

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.torproject.jni.TorService
import java.util.WeakHashMap
import java.util.concurrent.Executor

/**
 * Mode Tor : le trafic de toutes les pages passe par le réseau Tor (bibliothèque officielle du Guardian Project).
 * Passage par le port « HTTP tunnel » de Tor : les noms de sites sont résolus dans Tor (pas de fuite DNS) ;
 * seules les adresses HTTPS fonctionnent. WebRTC est coupé pour que les appels vidéo ne révèlent pas l'adresse IP.
 */
class TorMode(private val ctx: Context) {
    enum class State { OFF, STARTING, ON, ERROR }
    @Volatile var state = State.OFF; private set
    var error = ""
    var onState: (State) -> Unit = {}
    private val main = Handler(Looper.getMainLooper())
    private val run = Executor { it.run() }
    private var service: TorService? = null
    private var conn: ServiceConnection? = null
    private var receiverOn = false
    private val scripts = WeakHashMap<WebView, ScriptHandler>()

    val supported: Boolean get() = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    } catch (_: Throwable) { false }

    private val noWebRtc = """(function(){try{['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCIceCandidate','RTCSessionDescription'].forEach(function(k){
Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false});});}catch(e){}})();"""

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.getStringExtra(TorService.EXTRA_STATUS) == TorService.STATUS_ON && state == State.STARTING) applyWhenReady()
        }
    }

    private fun set(s: State) { state = s; main.post { onState(s) } }

    fun start() {
        if (state == State.STARTING || state == State.ON) return
        if (!supported) { error = t("Ton « Android System WebView » est trop ancien pour le mode Tor. Mets-le à jour depuis le Play Store."); set(State.ERROR); return }
        set(State.STARTING)
        if (!receiverOn) {
            val f = IntentFilter(TorService.ACTION_STATUS)
            if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED) else ctx.registerReceiver(receiver, f)
            receiverOn = true
        }
        val c = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) { service = (binder as? TorService.LocalBinder)?.service; applyWhenReady() }
            override fun onServiceDisconnected(name: ComponentName?) { service = null; if (state != State.OFF) { clearProxy(); error = t("Le service Tor s’est arrêté."); set(State.ERROR) } }
        }
        conn = c
        ctx.bindService(Intent(ctx, TorService::class.java), c, Context.BIND_AUTO_CREATE)
    }

    /** Attend que Tor ouvre son port (90 s au plus), puis fait passer toutes les pages par lui. */
    private fun applyWhenReady() {
        val svc = service ?: return
        Thread {
            val t0 = System.currentTimeMillis()
            var port = -1
            while (state == State.STARTING && System.currentTimeMillis() - t0 < 90_000) {
                port = try { svc.httpTunnelPort } catch (_: Exception) { -1 }
                if (port > 0) break
                Thread.sleep(500)
            }
            main.post {
                if (state != State.STARTING) return@post
                if (port <= 0) { error = t("Connexion au réseau Tor impossible (délai dépassé)."); stop(); set(State.ERROR); return@post }
                ProxyController.getInstance().setProxyOverride(ProxyConfig.Builder().addProxyRule("127.0.0.1:$port").build(), run) { set(State.ON) }
            }
        }.start()
    }

    private fun clearProxy() { try { ProxyController.getInstance().clearProxyOverride(run) {} } catch (_: Exception) {} }

    fun stop() {
        clearProxy()
        conn?.let { try { ctx.unbindService(it) } catch (_: Exception) {} }
        conn = null; service = null
        try { ctx.stopService(Intent(ctx, TorService::class.java)) } catch (_: Exception) {}
        if (receiverOn) { try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}; receiverOn = false }
        for ((_, h) in scripts) try { h.remove() } catch (_: Exception) {}
        scripts.clear()
        if (state != State.ERROR) set(State.OFF)
    }

    /** WebRTC coupé dans chaque onglet tant que Tor est actif (à appeler à la création des onglets et à l'activation). */
    fun protect(web: WebView) {
        if (state == State.OFF || state == State.ERROR || scripts.containsKey(web) || !supported) return
        try { scripts[web] = WebViewCompat.addDocumentStartJavaScript(web, noWebRtc, setOf("*")) } catch (_: Exception) {}
    }
}
