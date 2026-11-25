package com.aqis.ocr

import android.app.Activity
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
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

@InvokeArg
class UnitArgs {
    lateinit var unitId: String
}

@TauriPlugin
class AdsPlugin(private val activity: Activity) : Plugin(activity) {

    private var sdkStarted = false
    private var banner: AdView? = null
    private var interstitial: InterstitialAd? = null
    private var interstitialLoading = false
    private var interstitialUnitId: String? = null

    // ---------- ১. সম্মতি (UMP) + SDK চালু ----------
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

    // ---------- ২. ব্যানার (নিচে লেগে থাকে) ----------
    @Command
    fun showBanner(invoke: Invoke) {
        val args = invoke.parseArgs(UnitArgs::class.java)
        activity.runOnUiThread {
            try {
                if (!canRequestAds()) {
                    invoke.reject("সম্মতি ছাড়া বিজ্ঞাপন দেখানো যাবে না")
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

                // নেভিগেশন বারের নিচে ঢেকে গেলে ওপরে তুলে ধরি
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
                o.put("height", size.height) // dp
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

    // ---------- ৩. ইন্টারস্টিশিয়াল (পুরো পর্দা) ----------
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

    // ---------- ৪. গোপনীয়তা বিকল্প (ইউরোপ/UK-এর জন্য বাধ্যতামূলক) ----------
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
}
