package com.aqis.ocr

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

@InvokeArg
class DownloadArgs {
    lateinit var url: String
}

@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {

    @Volatile private var state: String = "idle" // idle | downloading | done | error
    @Volatile private var downloaded: Long = 0L
    @Volatile private var total: Long = -1L
    @Volatile private var errorMsg: String = ""

    private fun apkFile(): File = File(File(activity.cacheDir, "updates"), "update.apk")

    @Command
    fun download(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)

        if (!args.url.startsWith("https://")) {
            invoke.reject("শুধু https লিংক অনুমোদিত")
            return
        }
        if (state == "downloading") {
            invoke.resolve()
            return
        }

        state = "downloading"
        downloaded = 0L
        total = -1L
        errorMsg = ""

        Thread {
            var conn: HttpURLConnection? = null
            try {
                val dir = File(activity.cacheDir, "updates")
                dir.mkdirs()
                val out = apkFile()
                val tmp = File(dir, "update.apk.part")
                if (tmp.exists()) tmp.delete()
                if (out.exists()) out.delete()

                conn = URL(args.url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 30000
                conn.instanceFollowRedirects = true
                conn.connect()

                if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                    throw IOException("HTTP ${conn.responseCode}")
                }
                total = conn.contentLengthLong

                conn.inputStream.use { input ->
                    FileOutputStream(tmp).use { output ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            downloaded += n
                        }
                    }
                }

                if (total > 0 && downloaded != total) {
                    throw IOException("ডাউনলোড অসম্পূর্ণ")
                }
                if (!tmp.renameTo(out)) {
                    throw IOException("ফাইল সেভ করা যায়নি")
                }
                state = "done"
            } catch (e: Exception) {
                errorMsg = e.message ?: e.toString()
                state = "error"
            } finally {
                conn?.disconnect()
            }
        }.start()

        invoke.resolve()
    }

    @Command
    fun progress(invoke: Invoke) {
        val o = JSObject()
        o.put("state", state)
        o.put("downloaded", downloaded)
        o.put("total", total)
        o.put("error", errorMsg)
        invoke.resolve(o)
    }

    @Command
    fun install(invoke: Invoke) {
        val file = apkFile()
        if (!file.exists()) {
            invoke.reject("APK ফাইল পাওয়া যায়নি")
            return
        }

        // নিরাপত্তা: APK-টা এই অ্যাপেরই কিনা যাচাই
        @Suppress("DEPRECATION")
        val info = activity.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
        if (info == null || info.packageName != activity.packageName) {
            invoke.reject("অবৈধ APK ফাইল")
            return
        }

        // "অজানা উৎস থেকে ইনস্টল" অনুমতি
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            val settings = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(settings)

            val o = JSObject()
            o.put("needsPermission", true)
            invoke.resolve(o)
            return
        }

        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.updatefileprovider",
            file
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)

        val o = JSObject()
        o.put("needsPermission", false)
        invoke.resolve(o)
    }
}
