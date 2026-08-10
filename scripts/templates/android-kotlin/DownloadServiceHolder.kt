package com.acorn.videodownloader

import android.app.Activity
import java.util.concurrent.atomic.AtomicReference

/** Holds Activity and plugin refs for background download orchestration. */
object DownloadServiceHolder {
  private val activityRef = AtomicReference<Activity?>(null)
  private val ytdlpRef = AtomicReference<YtdlpPlugin?>(null)

  data class PendingNavigation(
    val sharedUrl: String? = null,
    val openPage: String? = null,
  )

  @Volatile
  private var pendingNavigation = PendingNavigation()

  fun bind(activity: Activity, ytdlp: YtdlpPlugin) {
    activityRef.set(activity)
    ytdlpRef.set(ytdlp)
  }

  fun unbind(activity: Activity) {
    if (activityRef.get() === activity) {
      activityRef.set(null)
    }
  }

  fun activity(): Activity? = activityRef.get()

  fun ytdlp(): YtdlpPlugin? = ytdlpRef.get()

  /** Queue navigation extras from share intent or notification tap. */
  fun setPendingNavigation(sharedUrl: String? = null, openPage: String? = null) {
    pendingNavigation =
      PendingNavigation(
        sharedUrl = sharedUrl ?: pendingNavigation.sharedUrl,
        openPage = openPage ?: pendingNavigation.openPage,
      )
  }

  /** Read and clear pending navigation for the WebView layer. */
  fun consumePendingNavigation(): PendingNavigation {
    val nav = pendingNavigation
    pendingNavigation = PendingNavigation()
    return nav
  }
}
