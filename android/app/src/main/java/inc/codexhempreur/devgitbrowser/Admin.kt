package inc.codexhempreur.devgitbrowser

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** scrypt (RFC 7914), identique à crypto.scryptSync de Node : vérifie la clé admin sans la stocker. */
object Scrypt {
    fun derive(pass: ByteArray, salt: ByteArray, n: Int, r: Int, p: Int, dkLen: Int): ByteArray {
        require(n > 1 && n and (n - 1) == 0) { "N doit être une puissance de 2" }
        val b = pbkdf2(pass, salt, p * 128 * r)
        val words = 32 * r
        val x = IntArray(words); val v = IntArray(words * n); val y = IntArray(words)
        for (i in 0 until p) {
            val off = i * 128 * r
            for (k in 0 until words) x[k] = le(b, off + 4 * k)
            for (j in 0 until n) { System.arraycopy(x, 0, v, j * words, words); blockMix(x, y, r) }
            for (j in 0 until n) {
                val idx = x[(2 * r - 1) * 16] and (n - 1)
                for (k in 0 until words) x[k] = x[k] xor v[idx * words + k]
                blockMix(x, y, r)
            }
            for (k in 0 until words) { val w = x[k]; b[off + 4 * k] = w.toByte(); b[off + 4 * k + 1] = (w ushr 8).toByte(); b[off + 4 * k + 2] = (w ushr 16).toByte(); b[off + 4 * k + 3] = (w ushr 24).toByte() }
        }
        return pbkdf2(pass, b, dkLen)
    }

    private fun le(b: ByteArray, i: Int) = (b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8) or ((b[i + 2].toInt() and 0xff) shl 16) or ((b[i + 3].toInt() and 0xff) shl 24)

    private fun pbkdf2(pass: ByteArray, salt: ByteArray, len: Int): ByteArray {
        // Clé HMAC vide = un octet nul (même remplissage par des zéros).
        val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(if (pass.isEmpty()) byteArrayOf(0) else pass, "HmacSHA256"))
        val out = ByteArray(len); var block = 1; var pos = 0
        while (pos < len) {
            mac.update(salt); mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
            val u = mac.doFinal()
            val n = minOf(u.size, len - pos); System.arraycopy(u, 0, out, pos, n); pos += n; block++
        }
        return out
    }

    private fun blockMix(b: IntArray, y: IntArray, r: Int) {
        val x = IntArray(16); System.arraycopy(b, (2 * r - 1) * 16, x, 0, 16)
        for (i in 0 until 2 * r) {
            for (k in 0 until 16) x[k] = x[k] xor b[i * 16 + k]
            salsa8(x)
            System.arraycopy(x, 0, y, i * 16, 16)
        }
        for (i in 0 until r) { System.arraycopy(y, (2 * i) * 16, b, i * 16, 16); System.arraycopy(y, (2 * i + 1) * 16, b, (r + i) * 16, 16) }
    }

    private fun salsa8(b: IntArray) {
        val x = b.copyOf()
        fun r(a: Int, n: Int) = Integer.rotateLeft(a, n)
        for (i in 0 until 4) {
            x[4] = x[4] xor r(x[0] + x[12], 7); x[8] = x[8] xor r(x[4] + x[0], 9); x[12] = x[12] xor r(x[8] + x[4], 13); x[0] = x[0] xor r(x[12] + x[8], 18)
            x[9] = x[9] xor r(x[5] + x[1], 7); x[13] = x[13] xor r(x[9] + x[5], 9); x[1] = x[1] xor r(x[13] + x[9], 13); x[5] = x[5] xor r(x[1] + x[13], 18)
            x[14] = x[14] xor r(x[10] + x[6], 7); x[2] = x[2] xor r(x[14] + x[10], 9); x[6] = x[6] xor r(x[2] + x[14], 13); x[10] = x[10] xor r(x[6] + x[2], 18)
            x[3] = x[3] xor r(x[15] + x[11], 7); x[7] = x[7] xor r(x[3] + x[15], 9); x[11] = x[11] xor r(x[7] + x[3], 13); x[15] = x[15] xor r(x[11] + x[7], 18)
            x[1] = x[1] xor r(x[0] + x[3], 7); x[2] = x[2] xor r(x[1] + x[0], 9); x[3] = x[3] xor r(x[2] + x[1], 13); x[0] = x[0] xor r(x[3] + x[2], 18)
            x[6] = x[6] xor r(x[5] + x[4], 7); x[7] = x[7] xor r(x[6] + x[5], 9); x[4] = x[4] xor r(x[7] + x[6], 13); x[5] = x[5] xor r(x[4] + x[7], 18)
            x[11] = x[11] xor r(x[10] + x[9], 7); x[8] = x[8] xor r(x[11] + x[10], 9); x[9] = x[9] xor r(x[8] + x[11], 13); x[10] = x[10] xor r(x[9] + x[8], 18)
            x[12] = x[12] xor r(x[15] + x[14], 7); x[13] = x[13] xor r(x[12] + x[15], 9); x[14] = x[14] xor r(x[13] + x[12], 13); x[15] = x[15] xor r(x[14] + x[13], 18)
        }
        for (i in 0 until 16) b[i] += x[i]
    }

    /** Empreinte « scrypt$sel$hash » (base64) produite par le navigateur PC. */
    fun verify(secret: String, stored: String): Boolean {
        val parts = stored.split('$'); if (parts.size != 3 || parts[0] != "scrypt") return false
        val salt = java.util.Base64.getDecoder().decode(parts[1]); val want = java.util.Base64.getDecoder().decode(parts[2])
        val got = derive(secret.toByteArray(Charsets.UTF_8), salt, 1 shl 15, 8, 1, 32)
        return MessageDigest.isEqual(got, want)
    }
}

object AdminKeys {
    const val ORIGINAL_KEY_HASH = "scrypt\$3aobrPBELytNKF+YlFs2mQ==\$5K0me2p1o9W3bZTnP3nKun7Q3kuF+GfekdFs7RTK4Fk="
    const val RECOVERY_HASH = "scrypt\$OdR+XUpKZUPgs5awnaiiug==\$JFdn2G1b+6/Yn3FkMsTc7wtazWyiUGRR5EH6rhcwd6o="
    val COMMAND = Regex("^\\s*%AdminDBG%\\s*$", RegexOption.IGNORE_CASE)
    fun normalizeKey(key: String): String {
        val raw = key.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
        val body = if (raw.startsWith("DGB")) raw.substring(3) else raw
        return if (body.length == 16) "DGB-" + body.chunked(4).joinToString("-") else key.trim()
    }
    fun recoveryPhrase(words: List<String>) = words.take(3).joinToString("|") { it.trim().lowercase() }
}

/** Accès admin : clé ou mots de sécurité (mêmes que sur PC), anti-essais, jeton du serveur chiffré par le Keystore. */
class Admin(ctx: Context) {
    private val sp = ctx.getSharedPreferences("dgb-admin", Context.MODE_PRIVATE)
    @Volatile var sessionUntil = 0L
    val open get() = System.currentTimeMillis() < sessionUntil

    fun lockedFor(): Long = maxOf(0, sp.getLong("lockUntil", 0) - System.currentTimeMillis())
    private fun fail() {
        val n = sp.getInt("fails", 0) + 1
        val e = sp.edit().putInt("fails", n)
        if (n >= 5) e.putLong("lockUntil", System.currentTimeMillis() + 120_000L * (1L shl minOf(n - 5, 6)))
        e.apply()
    }
    private fun ok() { sp.edit().putInt("fails", 0).putLong("lockUntil", 0).apply(); sessionUntil = System.currentTimeMillis() + 30 * 60_000 }

    /** À appeler hors du fil principal (scrypt ≈ 0,3 s). */
    fun unlockWithKey(key: String): Boolean {
        if (lockedFor() > 0) return false
        val good = Scrypt.verify(AdminKeys.normalizeKey(key), AdminKeys.ORIGINAL_KEY_HASH)
        if (good) ok() else fail(); return good
    }
    fun unlockWithWords(words: List<String>): Boolean {
        if (lockedFor() > 0 || words.size != 3) return false
        val good = Scrypt.verify(AdminKeys.recoveryPhrase(words), AdminKeys.RECOVERY_HASH)
        if (good) ok() else fail(); return good
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry("dgb-admin", null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder("dgb-admin", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return gen.generateKey()
    }
    val hasToken get() = sp.contains("token")
    fun token(): String? = try {
        val data = Base64.decode(sp.getString("token", null) ?: return null, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        String(c.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
    } catch (_: Exception) { null }
    fun setToken(token: String?) {
        if (token.isNullOrBlank()) { sp.edit().remove("token").apply(); return }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        sp.edit().putString("token", Base64.encodeToString(c.iv + c.doFinal(token.trim().toByteArray()), Base64.NO_WRAP)).apply()
    }
}
