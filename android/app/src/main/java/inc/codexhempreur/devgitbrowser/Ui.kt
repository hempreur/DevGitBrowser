package inc.codexhempreur.devgitbrowser

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

object C {
    const val BG = 0xFF0D0B1C.toInt()
    const val BAR = 0xFF120F26.toInt()
    const val SURFACE = 0xFF17132F.toInt()
    const val SURFACE2 = 0xFF201A42.toInt()
    const val LINE = 0xFF2C2558.toInt()
    const val TEXT = 0xFFECEAF8.toInt()
    const val MUTED = 0xFF9D93C4.toInt()
    const val ACCENT = 0xFF7C5CFF.toInt()
    const val GOOD = 0xFF6EE7A8.toInt()
    const val WARN = 0xFFFFB86B.toInt()
    const val BAD = 0xFFFF6B8B.toInt()
    const val PRIVATE = 0xFF2A1240.toInt()
}

fun Context.dp(v: Number): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

fun rounded(color: Int, radius: Int, stroke: Int = 0, strokeColor: Int = 0): GradientDrawable =
    GradientDrawable().apply { setColor(color); cornerRadius = radius.toFloat(); if (stroke > 0) setStroke(stroke, strokeColor) }

fun View.ripple(radius: Int = 0, base: Int = Color.TRANSPARENT) {
    background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), rounded(base, radius), rounded(Color.WHITE, radius))
}

fun Context.text(s: String, size: Float = 15f, color: Int = C.TEXT, bold: Boolean = false, lines: Int = 0): TextView = TextView(this).apply {
    text = s; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    if (lines > 0) { maxLines = lines; ellipsize = TextUtils.TruncateAt.END }
}

fun Context.button(label: String, primary: Boolean = false, onClick: () -> Unit): TextView = text(label, 14f, if (primary) Color.WHITE else C.TEXT, bold = true).apply {
    gravity = Gravity.CENTER; setPadding(dp(16), dp(10), dp(16), dp(10))
    background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), rounded(if (primary) C.ACCENT else C.SURFACE2, dp(10), if (primary) 0 else dp(1), C.LINE), null)
    isClickable = true; isFocusable = true; setOnClickListener { onClick() }
}

fun Context.iconButton(res: Int, desc: String, onClick: () -> Unit): ImageView = ImageView(this).apply {
    setImageResource(res); contentDescription = desc; setColorFilter(C.TEXT)
    scaleType = ImageView.ScaleType.CENTER; ripple(dp(20)); setOnClickListener { onClick() }
    layoutParams = LinearLayout.LayoutParams(dp(42), dp(42))
}

fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, weight: Float = 0f) =
    LinearLayout.LayoutParams(w, h, weight)

fun LinearLayout.LayoutParams.margins(l: Int = 0, t: Int = 0, r: Int = 0, b: Int = 0) = apply { setMargins(l, t, r, b) }

/** Écran plein (favoris, historique, réglages…) posé par-dessus le navigateur ; le bouton retour le ferme. */
class Screen(val activity: Activity, title: String, private val host: FrameLayout, private val stack: MutableList<Screen>) {
    val root = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(C.BG); isClickable = true }
    val body = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(activity.dp(14), activity.dp(6), activity.dp(14), activity.dp(24)) }
    val header = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(C.BAR); setPadding(activity.dp(6), activity.dp(4), activity.dp(10), activity.dp(4)) }
    var onClose: () -> Unit = {}

    init {
        val back = activity.text("←", 22f).apply { gravity = Gravity.CENTER; contentDescription = t("Retour"); ripple(activity.dp(20)); setOnClickListener { close() } }
        header.addView(back, LinearLayout.LayoutParams(activity.dp(44), activity.dp(44)))
        header.addView(activity.text(title, 18f, bold = true, lines = 1), lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).margins(l = activity.dp(4)))
        root.addView(header, lp())
        root.addView(ScrollView(activity).apply { isFillViewport = true; addView(body) }, lp(h = 0, weight = 1f))
    }

    fun show(): Screen { host.addView(root, FrameLayout.LayoutParams(-1, -1)); host.visibility = View.VISIBLE; stack.add(this); return this }
    fun close() {
        host.removeView(root); stack.remove(this)
        if (stack.isEmpty()) host.visibility = View.GONE
        onClose()
    }

    fun section(title: String) { body.addView(activity.text(title.uppercase(), 12f, C.MUTED, bold = true), lp().margins(t = activity.dp(18), b = activity.dp(6))) }

    fun row(title: String, sub: String? = null, onClick: (() -> Unit)? = null, onLong: (() -> Unit)? = null, trailing: View? = null): LinearLayout {
        val r = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(activity.dp(12), activity.dp(10), activity.dp(8), activity.dp(10)) }
        val col = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        col.addView(activity.text(title, 15f, lines = 2))
        if (!sub.isNullOrEmpty()) col.addView(activity.text(sub, 12.5f, C.MUTED, lines = 2))
        r.addView(col, lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (trailing != null) r.addView(trailing)
        r.background = RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), rounded(C.SURFACE, activity.dp(12)), null)
        if (onClick != null) r.setOnClickListener { onClick() }
        if (onLong != null) r.setOnLongClickListener { onLong(); true }
        body.addView(r, lp().margins(b = activity.dp(6)))
        return r
    }

    fun switch(title: String, sub: String?, value: Boolean, onChange: (Boolean) -> Unit) {
        val sw = Switch(activity).apply { isChecked = value; setOnCheckedChangeListener { _, v -> onChange(v) } }
        row(title, sub, onClick = { sw.toggle() }, trailing = sw)
    }

    fun note(s: String) { body.addView(activity.text(s, 13f, C.MUTED), lp().margins(t = activity.dp(4), b = activity.dp(8))) }
    fun empty(s: String) { body.addView(activity.text(s, 14f, C.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, activity.dp(40), 0, activity.dp(40)) }, lp()) }
}
