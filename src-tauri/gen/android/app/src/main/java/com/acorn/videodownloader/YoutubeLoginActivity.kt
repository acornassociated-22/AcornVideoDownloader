package com.acorn.videodownloader

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** Full-screen WebView for YouTube / Google sign-in; writes authenticated cookies on success. */
class YoutubeLoginActivity : Activity() {
  companion object {
    private const val TAG = "YoutubeLogin"
    private const val START_URL = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/"
  }

  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.parseColor("#141416")

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#141416"))
      layoutParams =
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }

    val toolbar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setBackgroundColor(Color.parseColor("#1c1c22"))
      setPadding(8, 0, 16, 0)
    }

    val closeBtn =
      ImageButton(this).apply {
        setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
        setBackgroundColor(Color.TRANSPARENT)
        setColorFilter(Color.WHITE)
        contentDescription = "Close"
        setOnClickListener { finish() }
      }

    val title =
      TextView(this).apply {
        text = "Sign in to YouTube"
        setTextColor(Color.WHITE)
        textSize = 16f
        setPadding(8, 24, 8, 24)
      }

    toolbar.addView(closeBtn)
    toolbar.addView(title)

    val webContainer =
      FrameLayout(this).apply {
        layoutParams =
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f,
          )
      }

    webView =
      WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.userAgentString =
          "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        webViewClient =
          object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
              view: WebView,
              request: WebResourceRequest,
            ): Boolean = shouldBlockExternalUrl(request.url.toString())

            @Deprecated("Deprecated in API")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
              shouldBlockExternalUrl(url)

            override fun onPageFinished(view: WebView, url: String) {
              Log.d(TAG, "loaded $url")
              if (url.contains("youtube.com") && !url.contains("accounts.google.com")) {
                CookieManager.getInstance().flush()
                CookieBootstrap.writeNetscapeFromWebView(this@YoutubeLoginActivity)
                PoTokenStore.harvestFromCookies(this@YoutubeLoginActivity)
                if (CookieBootstrap.isAuthenticated(CookieBootstrap.cookiesPath(this@YoutubeLoginActivity))) {
                  Log.i(TAG, "authenticated session saved")
                }
              }
            }
          }
        loadUrl(START_URL)
      }

    webContainer.addView(
      webView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    root.addView(toolbar)
    root.addView(webContainer)
    setContentView(root)

    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(0, sys.top, 0, sys.bottom)
      insets
    }
  }

  /** Allow only Google / YouTube domains (reuse CookieBootstrap rules). */
  private fun shouldBlockExternalUrl(url: String): Boolean {
    val lower = url.lowercase()
    if (lower.startsWith("intent:")) return true
    if (lower.startsWith("market:")) return true
    if (lower.startsWith("https://accounts.google.com")) return false
    if (lower.startsWith("http://accounts.google.com")) return false
    if (lower.startsWith("https://www.youtube.com")) return false
    if (lower.startsWith("https://youtube.com")) return false
    if (lower.startsWith("https://m.youtube.com")) return false
    if (lower.startsWith("http://www.youtube.com")) return false
    if (lower.startsWith("http://youtube.com")) return false
    if (lower.startsWith("http://m.youtube.com")) return false
    if (lower.startsWith("https://consent.youtube.com")) return false
    if (lower.startsWith("https://myaccount.google.com")) return false
    return true
  }

  override fun onDestroy() {
    webView?.destroy()
    webView = null
    super.onDestroy()
  }
}
