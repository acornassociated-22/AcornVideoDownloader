package com.acorn.videodownloader

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Tauri entry + chrome sync; engine starts only after Tauri native loads. */
class MainActivity : TauriActivity() {
  companion object {
    const val EXTRA_OPEN_PAGE = "open_page"
    private val YOUTUBE_URL =
      Regex(
        """(?i)(https?://(?:www\.)?(?:youtube\.com/watch\?[^\s]+|youtu\.be/[^\s]+|youtube\.com/shorts/[^\s]+))""",
      )
  }

  /** Last in-app theme; survives OS day/night flips until JS re-syncs. */
  private var appIsDark: Boolean = true

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applyChrome(true)
    window.decorView.post { attachChromeBridge() }
    window.decorView.postDelayed({ attachChromeBridge() }, 400)
    window.decorView.postDelayed({ attachChromeBridge() }, 1200)
    EngineBootstrap.start(applicationContext)
    window.decorView.postDelayed({
      if (!isFinishing && !isDestroyed) CookieBootstrap.start(this)
    }, 3000)
    handleIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIntent(intent)
  }

  override fun onDestroy() {
    DownloadServiceHolder.unbind(this)
    super.onDestroy()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    DownloadPlugin.onRequestPermissionsResult(requestCode, grantResults)
  }

  /** Handle share target and notification deep links. */
  private fun handleIntent(intent: Intent?) {
    intent ?: return
    if (Intent.ACTION_SEND == intent.action && "text/plain" == intent.type) {
      val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
      extractYoutubeUrl(text)?.let { url ->
        DownloadServiceHolder.setPendingNavigation(sharedUrl = url)
      }
      return
    }
    intent.getStringExtra(EXTRA_OPEN_PAGE)?.let { page ->
      DownloadServiceHolder.setPendingNavigation(openPage = page)
    }
  }

  /** Extract first YouTube URL from shared text. */
  private fun extractYoutubeUrl(text: String): String? {
    return YOUTUBE_URL.find(text)?.value
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyChrome(appIsDark)
  }

  /**
   * Draw edge-to-edge with transparent system bars so CSS `--a-bg` fills the
   * status-bar region (fixes white bar when OS is light but app is dark).
   */
  fun applyChrome(isDark: Boolean) {
    appIsDark = isDark
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = !isDark
      isAppearanceLightNavigationBars = !isDark
    }
  }

  /** Expose chrome sync + system insets to the WebView. */
  private fun attachChromeBridge() {
    val webView = findWebView(window.decorView) ?: return
    webView.addJavascriptInterface(ChromeBridge(), "AcornChrome")
  }

  /** Depth-first search for the Tauri WebView. */
  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }

  /** JS bridge: window.AcornChrome.setDark / getInsets. */
  inner class ChromeBridge {
    @JavascriptInterface
    fun setDark(dark: Boolean) {
      runOnUiThread { applyChrome(dark) }
    }

    /** Return system bar insets in CSS pixels as JSON. */
    @JavascriptInterface
    fun getInsets(): String {
      val density = resources.displayMetrics.density
      val root = window.decorView
      val insets = ViewCompat.getRootWindowInsets(root)
      val sys = insets?.getInsets(WindowInsetsCompat.Type.systemBars())
      val topPx = ((sys?.top ?: 0) / density).toInt()
      val bottomPx = ((sys?.bottom ?: 0) / density).toInt()
      return """{"top":$topPx,"bottom":$bottomPx}"""
    }
  }
}
