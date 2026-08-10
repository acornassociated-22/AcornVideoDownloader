package com.acorn.videodownloader

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File

/**
 * Silently harvest YouTube cookies via WebView (guest session — no sign-in required).
 * Rotates common mobile browser user-agents so consent / VISITOR cookies accumulate.
 */
object CookieBootstrap {
  private const val TAG = "CookieBootstrap"
  private const val GUEST_REFRESH_MS = 15L * 60 * 1000
  private const val PROFILE_LOAD_MS = 3000L
  private const val PROFILE_MAX_MS = 8000L

  /** JS snippet to accept YouTube/Google consent when the GDPR wall appears. */
  private const val CONSENT_JS =
    """
    (function(){
      var selectors = [
        'button[aria-label*="Accept"]',
        'button[aria-label*="accept"]',
        'form[action*="consent"] button',
        'button.yt-spec-button-shape-next--filled',
        'button[type="submit"]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) { el.click(); return 'clicked'; }
      }
      return 'none';
    })();
    """

  private val loadUrls =
    listOf(
      "https://consent.youtube.com/m?continue=https%3A%2F%2Fwww.youtube.com%2F",
      "https://www.youtube.com/",
      "https://m.youtube.com/",
      "https://www.youtube.com/?app=desktop",
    )

  /** Browser profiles — UA rotation helps gather consent cookies without login. */
  private val browserProfiles =
    listOf(
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
      "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) EdgA/120.0.0.0 Mobile Safari/537.36",
    )

  @Volatile
  private var bootstrapStarted = false

  @Volatile
  private var captureInFlight = false

  /** Rotates starting UA profile on forced bot retries. */
  @Volatile
  private var profileRotationOffset = 0

  /** Path where Netscape cookies are written (same as Rust default). */
  fun cookiesPath(context: Context): File = File(context.filesDir, "youtube-cookies.txt")

  /** True when the file contains a signed-in YouTube session marker. */
  fun isAuthenticated(file: File): Boolean {
    if (!file.isFile || file.length() == 0L) return false
    return try {
      val text = file.readText()
      text.contains("LOGIN_INFO") ||
        text.contains("SAPISID") ||
        text.contains("__Secure-3PSID") ||
        text.contains("__Secure-1PSID")
    } catch (_: Exception) {
      false
    }
  }

  /** True when on-disk cookies are younger than the guest refresh window. */
  fun isFresh(context: Context): Boolean {
    val file = cookiesPath(context)
    if (!file.isFile || file.length() == 0L) return false
    val age = System.currentTimeMillis() - file.lastModified()
    return age in 0 until GUEST_REFRESH_MS
  }

  /** Snapshot of cookie file state. */
  fun status(context: Context): CookieStatus {
    val file = cookiesPath(context)
    val exists = file.isFile && file.length() > 0L
    val ageMs =
      if (exists) {
        (System.currentTimeMillis() - file.lastModified()).coerceAtLeast(0L)
      } else {
        -1L
      }
    val authenticated = exists && isAuthenticated(file)
    val state =
      when {
        !exists -> "missing"
        authenticated -> "ready"
        else -> "guest"
      }
    return CookieStatus(
      exists = exists,
      authenticated = authenticated,
      ageMs = ageMs,
      path = file.absolutePath,
      state = state,
    )
  }

  /** Schedule cookie harvest as soon as the activity is ready. */
  fun start(activity: Activity) {
    if (bootstrapStarted) return
    bootstrapStarted = true
    Handler(Looper.getMainLooper()).post {
      if (activity.isFinishing || activity.isDestroyed) return@post
      captureYoutubeCookies(activity, force = false)
    }
  }

  /**
   * Block until cookies exist or harvest finishes; starts harvest when missing.
   * Call from YtdlpPlugin before every yt-dlp invocation.
   */
  fun ensureBeforeYtdlp(activity: Activity, timeoutMs: Long = 28_000L): CookieStatus {
    val existing = status(activity)
    if (existing.exists && isFresh(activity) && !captureInFlight) return existing
    if (existing.exists && !isFresh(activity) && !captureInFlight) {
      Handler(Looper.getMainLooper()).post {
        if (!activity.isFinishing && !activity.isDestroyed) {
          captureYoutubeCookies(activity, force = true)
        }
      }
      return awaitReady(activity, timeoutMs)
    }
    if (!bootstrapStarted) {
      bootstrapStarted = true
      Handler(Looper.getMainLooper()).post {
        if (!activity.isFinishing && !activity.isDestroyed) {
          captureYoutubeCookies(activity, force = false)
        }
      }
    } else if (!captureInFlight && !existing.exists) {
      Handler(Looper.getMainLooper()).post {
        if (!activity.isFinishing && !activity.isDestroyed) {
          captureYoutubeCookies(activity, force = true)
        }
      }
    }
    return awaitReady(activity, timeoutMs)
  }

  /** Force a new silent harvest; when [force] is true, refresh even if cookies are fresh. */
  fun forceRefresh(activity: Activity, force: Boolean = false) {
    val existing = cookiesPath(activity)
    if (existing.isFile && isAuthenticated(existing)) {
      Log.d(TAG, "forceRefresh skipped — authenticated cookies on disk")
      return
    }
    if (!force && isFresh(activity)) {
      Log.d(TAG, "forceRefresh skipped — cookies still fresh")
      return
    }
    Handler(Looper.getMainLooper()).post {
      if (activity.isFinishing || activity.isDestroyed) return@post
      if (force) {
        profileRotationOffset = (profileRotationOffset + 1) % browserProfiles.size
        clearYoutubeCookieJar()
      }
      captureYoutubeCookies(activity, force = force)
    }
  }

  /** Refresh cookies between bot tiers — always rotate guest session. */
  fun refreshForBotRetry(activity: Activity) {
    val existing = cookiesPath(activity)
    if (existing.isFile && isAuthenticated(existing)) {
      Log.d(TAG, "bot tier retry — keeping authenticated cookies")
      return
    }
    forceRefresh(activity, force = true)
  }

  /** Block until harvest finishes or timeout; guest cookies are OK. */
  fun awaitReady(context: Context, timeoutMs: Long): CookieStatus {
    val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(500L)
    while (System.currentTimeMillis() < deadline) {
      if (captureInFlight) {
        Thread.sleep(150L)
        continue
      }
      val st = status(context)
      if (st.exists) return st
      if (bootstrapStarted) {
        Thread.sleep(200L)
        return status(context)
      }
      Thread.sleep(150L)
    }
    return status(context)
  }

  /** Block external app handoffs (intent://, vnd.youtube:, etc.). */
  private fun shouldBlockExternalUrl(url: String): Boolean {
    val lower = url.lowercase()
    if (lower.startsWith("intent:")) return true
    if (lower.startsWith("vnd.youtube:")) return true
    if (lower.startsWith("market:")) return true
    if (lower.startsWith("https://consent.youtube.com")) return false
    if (lower.startsWith("http://consent.youtube.com")) return false
    if (lower.startsWith("https://accounts.google.com")) return false
    if (lower.startsWith("http://accounts.google.com")) return false
    if (lower.startsWith("https://www.youtube.com")) return false
    if (lower.startsWith("https://youtube.com")) return false
    if (lower.startsWith("https://m.youtube.com")) return false
    if (lower.startsWith("http://www.youtube.com")) return false
    if (lower.startsWith("http://youtube.com")) return false
    if (lower.startsWith("http://m.youtube.com")) return false
    return true
  }

  /** Clear WebView cookie jar for YouTube/Google domains before a forced re-harvest. */
  private fun clearYoutubeCookieJar() {
    try {
      val manager = CookieManager.getInstance()
      val domains =
        listOf(
          "https://www.youtube.com",
          "https://m.youtube.com",
          "https://youtube.com",
          "https://consent.youtube.com",
          "https://accounts.google.com",
          ".youtube.com",
          ".google.com",
        )
      for (domain in domains) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          manager.removeSessionCookies(null)
        }
        manager.setCookie(domain, "VISITOR_INFO1_LIVE=; Max-Age=0")
        manager.setCookie(domain, "YSC=; Max-Age=0")
      }
      manager.flush()
      Log.d(TAG, "cleared YouTube cookie jar for forced refresh")
    } catch (e: Exception) {
      Log.w(TAG, "clearYoutubeCookieJar failed", e)
    }
  }

  /** Load YouTube with rotating browser UAs and export CookieManager cookies. */
  private fun captureYoutubeCookies(activity: Activity, force: Boolean) {
    val existing = cookiesPath(activity)
    if (existing.isFile && existing.length() > 0L) {
      val fresh = System.currentTimeMillis() - existing.lastModified() < GUEST_REFRESH_MS
      if (isAuthenticated(existing)) {
        Log.i(TAG, "skipping harvest — authenticated cookies on disk")
        return
      }
      if (!force && fresh) {
        Log.i(TAG, "skipping harvest — fresh cookies on disk (${existing.length()} bytes)")
        return
      }
    }

    if (captureInFlight) {
      Log.d(TAG, "harvest already in flight")
      return
    }
    captureInFlight = true
    harvestWithProfiles(activity, 0)
  }

  /** Attach a 1×1 invisible WebView so CookieManager / JS actually run. */
  private fun attachHarvestWebView(activity: Activity, webView: WebView) {
    val root = activity.window.decorView.findViewById<ViewGroup>(android.R.id.content)
    webView.layoutParams = FrameLayout.LayoutParams(1, 1)
    webView.visibility = View.INVISIBLE
    root.addView(webView)
  }

  /** Remove harvest WebView from the activity and destroy it. */
  private fun detachHarvestWebView(webView: WebView?) {
    if (webView == null) return
    try {
      (webView.parent as? ViewGroup)?.removeView(webView)
    } catch (_: Exception) {
    }
    try {
      webView.stopLoading()
      webView.destroy()
    } catch (_: Exception) {
    }
  }

  /** Sequentially load YouTube under each browser UA, then export merged cookies. */
  private fun harvestWithProfiles(activity: Activity, profileIndex: Int) {
    if (activity.isFinishing || activity.isDestroyed) {
      captureInFlight = false
      return
    }
    if (profileIndex >= browserProfiles.size) {
      finishHarvest(activity)
      return
    }

    val actualProfile = (profileRotationOffset + profileIndex) % browserProfiles.size
    val ua = browserProfiles[actualProfile]
    val url = loadUrls[(profileRotationOffset + profileIndex) % loadUrls.size]
    val handler = Handler(Looper.getMainLooper())
    var webView: WebView? = null
    var advanced = false

    fun advanceToNext(reason: String) {
      if (advanced) return
      advanced = true
      Log.d(TAG, "profile=$profileIndex done ($reason)")
      detachHarvestWebView(webView)
      webView = null
      harvestWithProfiles(activity, profileIndex + 1)
    }

    try {
      CookieManager.getInstance().setAcceptCookie(true)
      webView =
        WebView(activity).apply {
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          settings.databaseEnabled = true
          settings.userAgentString = ua
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
          }
          webViewClient =
            object : WebViewClient() {
              override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
              ): Boolean = shouldBlockExternalUrl(request.url.toString())

              @Deprecated("Deprecated in API")
              override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                shouldBlockExternalUrl(url)

              override fun onPageFinished(view: WebView, finishedUrl: String) {
                Log.d(TAG, "profile=$profileIndex loaded $finishedUrl")
                view.evaluateJavascript(CONSENT_JS, null)
                handler.removeCallbacksAndMessages(null)
                handler.postDelayed({ advanceToNext("onPageFinished") }, PROFILE_LOAD_MS)
              }
            }
        }
      attachHarvestWebView(activity, webView!!)
      Log.d(TAG, "profile=$profileIndex loading $url ua=${ua.take(40)}…")
      webView!!.loadUrl(url)
      handler.postDelayed({ advanceToNext("timeout") }, PROFILE_MAX_MS)
    } catch (e: Exception) {
      Log.w(TAG, "harvest profile=$profileIndex failed", e)
      detachHarvestWebView(webView)
      harvestWithProfiles(activity, profileIndex + 1)
    }
  }

  /** Flush CookieManager and write Netscape cookies file. */
  private fun finishHarvest(activity: Activity) {
    try {
      if (activity.isFinishing || activity.isDestroyed) return
      CookieManager.getInstance().flush()
      val out = cookiesPath(activity)
      writeNetscapeCookies(out)
      PoTokenStore.harvestFromCookies(activity)
      Log.i(
        TAG,
        "cookies harvested (${out.length()} bytes) authenticated=${isAuthenticated(out)}",
      )
    } catch (e: Exception) {
      Log.w(TAG, "cookie export failed", e)
    } finally {
      captureInFlight = false
    }
  }

  /** Export cookies from CookieManager after visible login WebView session. */
  fun writeNetscapeFromWebView(context: Context) {
    writeNetscapeCookies(cookiesPath(context))
  }

  /** Export cookies from CookieManager into Netscape format. */
  fun writeNetscapeCookies(out: File) {
    val manager = CookieManager.getInstance()
    manager.flush()
    val seen = linkedSetOf<String>()
    val sb = StringBuilder("# Netscape HTTP Cookie File\n")
    val urls =
      listOf(
        "https://consent.youtube.com",
        "https://www.youtube.com",
        "https://m.youtube.com",
        "https://youtube.com",
        "https://accounts.google.com",
      )
    for (url in urls) {
      val raw = manager.getCookie(url) ?: continue
      raw.split(";").forEach { part ->
        val kv = part.trim().split("=", limit = 2)
        if (kv.size != 2) return@forEach
        val name = kv[0].trim()
        val value = kv[1].trim()
        if (name.isEmpty()) return@forEach
        val key = "$name=$value"
        if (!seen.add(key)) return@forEach
        val domain =
          when {
            url.contains("google.com") -> ".google.com"
            url.contains("consent.youtube") -> ".youtube.com"
            else -> ".youtube.com"
          }
        sb.append("$domain\tTRUE\t/\tFALSE\t0\t$name\t$value\n")
      }
    }
    if (seen.isNotEmpty()) {
      out.writeText(sb.toString())
    } else {
      Log.w(TAG, "no cookies in CookieManager after harvest")
    }
  }

  /** Copy an imported cookies.txt into the app cookie path. */
  fun importCookiesFile(context: Context, source: File): Boolean {
    if (!source.isFile || source.length() == 0L) return false
    return try {
      val dest = cookiesPath(context)
      source.copyTo(dest, overwrite = true)
      bootstrapStarted = true
      Log.i(
        TAG,
        "imported cookies (${dest.length()} bytes) authenticated=${isAuthenticated(dest)}",
      )
      true
    } catch (e: Exception) {
      Log.w(TAG, "import cookies failed", e)
      false
    }
  }
}

/** Cookie file snapshot for plugin/Rust. */
data class CookieStatus(
  val exists: Boolean,
  val authenticated: Boolean,
  val ageMs: Long,
  val path: String,
  val state: String,
)
