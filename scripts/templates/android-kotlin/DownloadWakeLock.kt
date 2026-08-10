package com.acorn.videodownloader

import android.content.Context
import android.os.PowerManager
import android.util.Log

/** Partial wake lock during active yt-dlp download only. */
object DownloadWakeLock {
  private const val TAG = "DownloadWakeLock"
  private const val LOCK_TAG = "AcornVideoDownloader:DownloadWakeLock"
  private const val MAX_MS = 10L * 60 * 1000

  @Volatile
  private var wakeLock: PowerManager.WakeLock? = null

  /** Acquire partial wake lock with timeout. */
  fun acquire(context: Context) {
    try {
      release()
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock =
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, LOCK_TAG).apply {
          setReferenceCounted(false)
          acquire(MAX_MS)
        }
      wakeLock = lock
      Log.d(TAG, "acquired wake lock")
    } catch (e: Exception) {
      Log.w(TAG, "acquire failed", e)
    }
  }

  /** Release wake lock if held. */
  fun release() {
    try {
      wakeLock?.let {
        if (it.isHeld) it.release()
      }
      wakeLock = null
    } catch (e: Exception) {
      Log.w(TAG, "release failed", e)
    }
  }
}
