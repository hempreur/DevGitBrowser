package inc.codexhempreur.devgitbrowser

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

object Notifier {
    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("messages", t("Messages de DevGitBrowser"), NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel("updates", t("Mises à jour"), NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel("support", t("Support"), NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel("matchpulse", "MatchPulse", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel("achievements", t("Succès"), NotificationManager.IMPORTANCE_LOW))
    }

    fun show(ctx: Context, channel: String, id: Int, title: String, body: String, extra: String? = null) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (extra != null) intent.putExtra("dgb-open", extra)
        val open = PendingIntent.getActivity(ctx, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(ctx, channel).setSmallIcon(R.drawable.ic_shield).setContentTitle(title).setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body)).setContentIntent(open).setAutoCancel(true).build()
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}

/**
 * Relève en arrière-plan quand l'application est fermée (toutes les 15 min environ, selon Android) :
 * messages de l'éditeur, réponses du support et nouvelle version. Sans service Google (pas de Firebase).
 */
class BgJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        val a = applicationContext as App
        if (a.server.running || !a.server.available) return false
        Thread {
            try {
                Notifier.channels(this)
                val (msgs, support, latest) = a.server.pollBackground()
                for (m in msgs) if (m.id.toString() !in a.prefs.dismissed)
                    Notifier.show(this, "messages", (m.id % 100000).toInt(), if (m.level == "alert") "⚠️ DevGitBrowser" else "📣 DevGitBrowser", m.text)
                for (v in support) {
                    val last = v.messages.lastOrNull { it.from != "system" } ?: continue
                    if (last.from == "admin") Notifier.show(this, "support", 9000 + v.bugId.hashCode() % 1000, t("💬 Réponse du support DevGitBrowser"), last.text.take(200), "support:" + v.bugId)
                }
                if (Versions.newer(latest, BuildConfig.VERSION_NAME) && a.prefs.notifiedVersion != latest) {
                    a.prefs.notifiedVersion = latest
                    Notifier.show(this, "updates", 7, t("Mise à jour disponible"), t("DevGitBrowser %s est disponible.").format(latest))
                }
            } catch (_: Exception) {}
            jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters) = true

    companion object {
        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java)
            if (js.allPendingJobs.any { it.id == 4201 }) return
            js.schedule(JobInfo.Builder(4201, ComponentName(ctx, BgJob::class.java))
                .setPeriodic(15 * 60_000L).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build())
        }
    }
}
