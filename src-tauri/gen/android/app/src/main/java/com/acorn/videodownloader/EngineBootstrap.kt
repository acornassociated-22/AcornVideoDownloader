package com.acorn.videodownloader

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Silent YoutubeDL + FFmpeg init with unlimited retry. Started from Application.onCreate.
 * Requires android:extractNativeLibs="true" so libpython.zip.so is on disk.
 */
object EngineBootstrap {
  private const val TAG = "EngineBootstrap"

  @Volatile
  private var appContext: Context? = null

  @Volatile
  private var ready: Boolean = false

  @Volatile
  var lastError: String? = null
    private set

  private val readyCallbacks = CopyOnWriteArrayList<() -> Unit>()
  private val lock = Any()

  @Volatile
  private var started = false

  /** Begin background init (idempotent). */
  fun start(context: Context) {
    synchronized(lock) {
      if (started) return
      started = true
      appContext = context.applicationContext
      Thread(
        {
          var attempt = 0
          while (!ready) {
            val ctx = appContext ?: return@Thread
            try {
              logNativeLayout(ctx, attempt)
              YtdlpUpdater.restoreIfBroken(ctx)
              YoutubeDL.getInstance().init(ctx)
              try {
                FFmpeg.getInstance().init(ctx)
              } catch (e: Exception) {
                Log.w(TAG, "FFmpeg.init failed (will retry via FfmpegHelper)", e)
              }
              FfmpegHelper.ensureReady(ctx)
              if (!FfmpegHelper.isReady()) {
                Log.w(TAG, "ffmpeg not verified — merge/audio extract may fail")
              }
              if (!binariesPresent(ctx)) {
                throw IllegalStateException(
                  "yt-dlp binaries missing after init " +
                    "(python=${pythonSo(ctx).isFile}, " +
                    "zip=${pythonZipSo(ctx).isFile}, " +
                    "script=${ytDlpScript(ctx).isFile})",
                )
              }
              ready = true
              lastError = null
              Log.i(TAG, "ready after ${attempt + 1} attempt(s)")
              readyCallbacks.forEach { cb ->
                try {
                  cb()
                } catch (e: Exception) {
                  Log.w(TAG, "ready callback failed", e)
                }
              }
              readyCallbacks.clear()
              Thread(
                {
                  try {
                    YtdlpUpdater.tryAutoUpdate(ctx)
                  } catch (e: Exception) {
                    Log.w(TAG, "yt-dlp auto-update failed", e)
                  }
                },
                "YtdlpAutoUpdate",
              ).start()
              return@Thread
            } catch (e: YoutubeDLException) {
              lastError = fullError(e)
              attempt++
              Log.e(TAG, "init attempt $attempt failed: $lastError", e)
            } catch (e: Throwable) {
              lastError = fullError(e)
              attempt++
              Log.e(TAG, "init attempt $attempt failed: $lastError", e)
            }
            val delayMs = minOf(800L * attempt, 5000L)
            Thread.sleep(delayMs)
          }
        },
        "EngineBootstrap",
      ).start()
    }
  }

  /** True when init succeeded and expected files exist. */
  fun isReady(): Boolean {
    val ctx = appContext ?: return false
    return ready && binariesPresent(ctx)
  }

  /** True when ffmpeg/ffprobe CLI copies are verified (merge + audio extract). */
  fun isFfmpegReady(): Boolean = FfmpegHelper.isReady()

  /** Block until ready or timeout; returns false on timeout. */
  fun awaitReady(timeoutMs: Long): Boolean {
    if (isReady()) return true
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (isReady()) return true
      Thread.sleep(200L)
    }
    return isReady()
  }

  /** Run callback once when engine is ready (or immediately if already ready). */
  fun whenReady(callback: () -> Unit) {
    if (isReady()) {
      callback()
      return
    }
    readyCallbacks.add(callback)
  }

  /** yt-dlp script + libpython.so must exist before execute. */
  private fun binariesPresent(context: Context): Boolean {
    return ytDlpScript(context).isFile && pythonSo(context).isFile
  }

  private fun ytDlpScript(context: Context): File =
    File(File(context.noBackupFilesDir, "youtubedl-android/yt-dlp"), "yt-dlp")

  private fun pythonSo(context: Context): File =
    File(context.applicationInfo.nativeLibraryDir, "libpython.so")

  private fun pythonZipSo(context: Context): File =
    File(context.applicationInfo.nativeLibraryDir, "libpython.zip.so")

  /** Log native dir contents once for diagnosing extractNativeLibs issues. */
  private fun logNativeLayout(context: Context, attempt: Int) {
    if (attempt > 0) return
    val dir = File(context.applicationInfo.nativeLibraryDir)
    val listing =
      dir.listFiles()?.joinToString(", ") { it.name } ?: "(empty or missing)"
    Log.i(
      TAG,
      "nativeLibraryDir=${dir.absolutePath} " +
        "python=${pythonSo(context).isFile} " +
        "pythonZip=${pythonZipSo(context).isFile} " +
        "files=[$listing]",
    )
  }

  /** Flatten exception chain for UI / lastError. */
  private fun fullError(e: Throwable): String {
    val parts = mutableListOf<String>()
    var cur: Throwable? = e
    var depth = 0
    while (cur != null && depth < 6) {
      val msg = cur.message?.trim().orEmpty()
      if (msg.isNotEmpty()) parts.add(msg)
      cur = cur.cause
      depth++
    }
    return parts.distinct().joinToString(" | ").ifBlank { e.javaClass.simpleName }
  }
}
