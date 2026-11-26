package com.aqis.ocr

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.ump.ConsentForm
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

@InvokeArg
class UnitArgs {
    lateinit var unitId: String
}

@InvokeArg
class DownloadArgs {
    var url: String = ""
}

@TauriPlugin
class AdsPlugin(private val activity: Activity) : Plugin(activity) {

    // ==================== ADS STATE ====================
    private var sdkStarted = false
    private var banner: AdView? = null
    private var mrec: AdView? = null
    private var interstitial: InterstitialAd? = null
    private var interstitialLoading = false
    private var interstitialUnitId: String? = null

    // ==================== UPDATE STATE ====================
    @Volatile private var dlState = "idle"
    @Volatile private var dlBytes = 0L
    @Volatile private var dlTotal = 0L
    @Volatile private var dlError = ""
    @Volatile private var dlPath = ""

    // ======================================================
    //  1. সম্মতি (UMP) + SDK চালু
    // ======================================================
    @Command
    fun init(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val ci = UserMessagingPlatform.getConsentInformation(activity)
                val params = ConsentRequestParameters.Builder().build()
                ci.requestConsentInfoUpdate(
                    activity,
                    params,
                    ConsentInformation.OnConsentInfoUpdateSuccessListener {
                        UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                            activity,
                            ConsentForm.OnConsentFormDismissedListener { _ ->
                                finishInit(invoke, ci)
                            }
                        )
                    },
                    ConsentInformation.OnConsentInfoUpdateFailureListener { _ ->
                        finishInit(invoke, ci)
                    }
                )
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    private fun finishInit(invoke: Invoke, ci: ConsentInformation) {
        val canRequest = ci.canRequestAds()
        if (canRequest) startSdk()
        val o = JSObject()
        o.put("canRequestAds", canRequest)
        o.put(
            "privacyOptionsRequired",
            ci.privacyOptionsRequirementStatus ==
                ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        )
        invoke.resolve(o)
    }

    private fun startSdk() {
        if (sdkStarted) return
        sdkStarted = true
        Thread { MobileAds.initialize(activity) { } }.start()
    }

    private fun canRequestAds(): Boolean =
        UserMessagingPlatform.getConsentInformation(activity).canRequestAds()

    // ======================================================
    //  2. ব্যানার (নিচে লেগে থাকে)
    // ======================================================
    @Command
    fun showBanner(invoke: Invoke) {
        val args = invoke.parseArgs(UnitArgs::class.java)
        activity.runOnUiThread {
            try {
                if (!canRequestAds()) {
                    invoke.reject("Consent not given")
                    return@runOnUiThread
                }
                startSdk()

                banner?.let {
                    (it.parent as? ViewGroup)?.removeView(it)
                    it.destroy()
                }

                val metrics = activity.resources.displayMetrics
                val widthDp = (metrics.widthPixels / metrics.density).toInt()
                val size = AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp)

                val adView = AdView(activity)
                adView.adUnitId = args.unitId
                adView.setAdSize(size)

                val root = activity.findViewById<ViewGroup>(android.R.id.content)
                val lp = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                )
                root.addView(adView, lp)

                ViewCompat.setOnApplyWindowInsetsListener(adView) { v, insets ->
                    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                    val p = v.layoutParams as FrameLayout.LayoutParams
                    if (p.bottomMargin != bars.bottom) {
                        p.bottomMargin = bars.bottom
                        v.layoutParams = p
                    }
                    insets
                }
                ViewCompat.requestApplyInsets(adView)

                adView.loadAd(AdRequest.Builder().build())
                banner = adView

                val o = JSObject()
                o.put("height", size.height)
                invoke.resolve(o)
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    @Command
    fun hideBanner(invoke: Invoke) {
        activity.runOnUiThread {
            banner?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                it.destroy()
            }
            banner = null
            invoke.resolve()
        }
    }

    // ======================================================
    //  2.5 Media Rectangle (300×250) — top during work
    // ======================================================
    private fun removeMrec() {
        mrec?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        mrec = null
    }

    @Command
    fun showMrec(invoke: Invoke) {
        val args = invoke.parseArgs(UnitArgs::class.java)
        activity.runOnUiThread {
            try {
                if (!canRequestAds()) {
                    invoke.reject("Consent not given")
                    return@runOnUiThread
                }
                startSdk()
                removeMrec()

                val root = activity.findViewById<ViewGroup>(android.R.id.content)
                val density = activity.resources.displayMetrics.density
                val topPx = ViewCompat.getRootWindowInsets(root)
                    ?.getInsets(WindowInsetsCompat.Type.systemBars())?.top ?: 0

                val adView = AdView(activity)
                adView.adUnitId = args.unitId
                adView.setAdSize(AdSize.MEDIUM_RECTANGLE)

                val lp = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP or Gravity.CENTER_HORIZONTAL
                )
                lp.topMargin = topPx
                root.addView(adView, lp)

                adView.loadAd(AdRequest.Builder().build())
                mrec = adView

                val o = JSObject()
                o.put("height", AdSize.MEDIUM_RECTANGLE.height)
                o.put("topInset", (topPx / density).toInt())
                invoke.resolve(o)
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    @Command
    fun hideMrec(invoke: Invoke) {
        activity.runOnUiThread {
            removeMrec()
            invoke.resolve()
        }
    }

    // ======================================================
    //  3. Interstitial (fullscreen)
    // ======================================================
    @Command
    fun loadInterstitial(invoke: Invoke) {
        val args = invoke.parseArgs(UnitArgs::class.java)
        activity.runOnUiThread {
            try {
                if (!canRequestAds()) {
                    invoke.resolve()
                    return@runOnUiThread
                }
                startSdk()
                interstitialUnitId = args.unitId
                loadInterstitialInternal(args.unitId)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    private fun loadInterstitialInternal(unitId: String) {
        if (interstitial != null || interstitialLoading) return
        interstitialLoading = true
        InterstitialAd.load(
            activity,
            unitId,
            AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: InterstitialAd) {
                    interstitial = ad
                    interstitialLoading = false
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    interstitial = null
                    interstitialLoading = false
                }
            }
        )
    }

    @Command
    fun showInterstitial(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val ad = interstitial
                val o = JSObject()
                if (ad == null) {
                    interstitialUnitId?.let { loadInterstitialInternal(it) }
                    o.put("shown", false)
                    invoke.resolve(o)
                    return@runOnUiThread
                }
                ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                    override fun onAdDismissedFullScreenContent() {
                        interstitial = null
                        interstitialUnitId?.let { loadInterstitialInternal(it) }
                    }

                    override fun onAdFailedToShowFullScreenContent(error: AdError) {
                        interstitial = null
                        interstitialUnitId?.let { loadInterstitialInternal(it) }
                    }
                }
                ad.show(activity)
                o.put("shown", true)
                invoke.resolve(o)
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    // ======================================================
    //  4. Privacy options (EU/UK)
    // ======================================================
    @Command
    fun privacyOptions(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                UserMessagingPlatform.showPrivacyOptionsForm(
                    activity,
                    ConsentForm.OnConsentFormDismissedListener { _ -> invoke.resolve() }
                )
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    // ======================================================
    //  5. UPDATE: download (native HTTP, no CORS)
    // ======================================================
    @Command
    fun update_download(invoke: Invoke) {
        val url = invoke.parseArgs(DownloadArgs::class.java).url
        if (url.isBlank() || !url.startsWith("https://", ignoreCase = true)) {
            invoke.reject("Invalid URL")
            return
        }

        GlobalScope.launch(Dispatchers.IO) {
            try {
                dlState = "downloading"
                dlBytes = 0
                dlTotal = 0
                dlError = ""
                dlPath = ""

                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 60_000
                    readTimeout = 60_000
                    setRequestProperty("User-Agent", "AQIS-Updater/1.0")
                }

                val code = conn.responseCode
                if (code != HttpURLConnection.HTTP_OK) {
                    dlState = "error"
                    dlError = "HTTP $code"
                    invoke.reject("HTTP $code")
                    return@launch
                }

                dlTotal = conn.contentLengthLong
                val outFile = File(activity.cacheDir, "update.apk")
                if (outFile.exists()) outFile.delete()

                conn.inputStream.use { input ->
                    FileOutputStream(outFile).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var n: Int
                        while (input.read(buf).also { n = it } != -1) {
                            out.write(buf, 0, n)
                            dlBytes += n
                        }
                    }
                }
                conn.disconnect()

                if (outFile.length() == 0L) {
                    dlState = "error"
                    dlError = "Empty file"
                    invoke.reject("Downloaded file is empty")
                    return@launch
                }

                dlPath = outFile.absolutePath
                dlState = "done"
                invoke.resolve()
            } catch (e: Exception) {
                dlState = "error"
                dlError = e.message ?: "Unknown error"
                invoke.reject(e.message ?: "Download failed")
            }
        }
    }

    // ======================================================
    //  6. UPDATE: progress polling
    // ======================================================
    @Command
    fun update_progress(invoke: Invoke) {
        val o = JSObject()
        o.put("state", dlState)
        o.put("downloaded", dlBytes)
        o.put("total", dlTotal)
        if (dlError.isNotEmpty()) o.put("error", dlError)
        if (dlPath.isNotEmpty()) o.put("path", dlPath)
        invoke.resolve(o)
    }

    // ======================================================
    //  7. UPDATE: open installer
    // ======================================================
    @Command
    fun update_install(invoke: Invoke) {
        val apkFile = if (dlPath.isNotEmpty()) File(dlPath)
                      else File(activity.cacheDir, "update.apk")

        if (!apkFile.exists()) {
            invoke.reject("APK not found. Download first.")
            return
        }

        try {
            val uri: Uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.updatefileprovider",
                apkFile
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Install failed")
        }
    }
}
