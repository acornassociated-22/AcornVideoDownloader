package com.acorn.videodownloader

import android.app.Activity
import android.os.Environment
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

@InvokeArg
class YtdlpExecuteArgs {
  lateinit var url: String
  var options: List<List<String>> = emptyList()
  var processId: String? = null
}

@InvokeArg
class AwaitReadyArgs {
  var timeoutMs: Long = 90_000L
}

@InvokeArg
class IdArgs {
  lateinit var id: String
}

@InvokeArg
class CookieAwaitArgs {
  var timeoutMs: Long = 8000L
}

@InvokeArg
class RefreshCookiesArgs {
  var force: Boolean = true
}

/** Result of one yt-dlp download attempt. */
private data class AttemptResult(
  val response: AcornYtdlpExecutor.Response,
  val savedPath: String?,
  val formatUsed: String?,
)

/**
 * Run yt-dlp via AcornYtdlpExecutor (custom ProcessBuilder + ffmpeg bin dir).
 * Rust must not spawn libpython itself on Android.
 */
@TauriPlugin
class YtdlpPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val TAG = "YtdlpPlugin"
    /** Max wait when engine is still cold; warm path skips this entirely. */
    private const val DEFAULT_AWAIT_MS = 90_000L

    /** YouTube player_client chains for bot-wall retry (matches Rust ytdlp.rs tiers). */
    private val YOUTUBE_CLIENT_TIERS =
      listOf(
        "youtube:player_client=default,-android_sdkless,ios,tv_embedded,mweb,web_safari",
        "youtube:player_client=default,-android_sdkless,tv_simply,tv_embedded,mweb,web_safari;player_skip=webpage",
        "youtube:player_client=default,-android_sdkless,android_vr,tv_embedded,tv,mweb",
        "youtube:player_client=default,-android_sdkless,web,web_safari,web_embedded,mweb;player_skip=webpage",
      )

    /** Guest-friendly bot error (matches frontend isYoutubeBotError). */
    private const val GUEST_BOT_ERROR_MSG =
      "YouTube blocked this request. Wait 30–60 seconds and try again."

    /** Public bot-error check for DownloadOrchestrator. */
    fun isYoutubeBotErrorPublic(text: String): Boolean {
      val lower = text.lowercase()
      return lower.contains("sign in to confirm") ||
        lower.contains("not a bot") ||
        lower.contains("blocked this request") ||
        lower.contains("http error 429") ||
        lower.contains("too many requests") ||
        lower.contains("video unavailable") ||
        lower.contains("this video is unavailable") ||
        lower.contains("error code: 152") ||
        lower.contains("downloaded file is empty") ||
        lower.contains("http error 403") ||
        lower.contains("no longer supported") ||
        lower.contains("not supported in this application")
    }

    /** Rust/Kotlin flags that must not reach a download yt-dlp invocation. */
    private val downloadBlockedFlags =
      setOf(
        "-o",
        "-f",
        "--merge-output-format",
        "-P",
        "--paths",
        "-J",
        "--dump-single-json",
        "--dump-json",
        "--flat-playlist",
        "--simulate",
        "--skip-download",
      )
  }

  private val executor = Executors.newCachedThreadPool()

  init {
    DownloadServiceHolder.bind(activity, this)
    DownloadOrchestrator.setEventSink { event, payload ->
      Log.d(TAG, "trigger event=$event")
      trigger(event, payload)
    }
  }

  @Command
  fun getCookiesPath(invoke: Invoke) {
    val path = CookieBootstrap.cookiesPath(activity).absolutePath
    val result = JSObject()
    result.put("path", path)
    invoke.resolve(result)
  }

  @Command
  fun getCookieStatus(invoke: Invoke) {
    invoke.resolve(cookieStatusObject())
  }

  @Command
  fun awaitCookiesReady(invoke: Invoke) {
    val args = invoke.parseArgs(CookieAwaitArgs::class.java)
    val timeoutMs = if (args.timeoutMs > 0) args.timeoutMs else 20_000L
    executor.execute {
      val st = CookieBootstrap.awaitReady(activity, timeoutMs)
      invoke.resolve(cookieStatusJs(st))
    }
  }

  @Command
  fun refreshCookies(invoke: Invoke) {
    val args = invoke.parseArgs(RefreshCookiesArgs::class.java)
    CookieBootstrap.forceRefresh(activity, force = args.force)
    executor.execute {
      val st = CookieBootstrap.awaitReady(activity, 14_000L)
      val result = cookieStatusJs(st)
      result.put("refreshed", args.force)
      invoke.resolve(result)
    }
  }

  /** Map CookieStatus to JSObject. */
  private fun cookieStatusJs(st: CookieStatus): JSObject {
    val result = JSObject()
    result.put("exists", st.exists)
    result.put("authenticated", st.authenticated)
    result.put("ageMs", st.ageMs)
    result.put("path", st.path)
    result.put("state", st.state)
    return result
  }

  private fun cookieStatusObject(): JSObject = cookieStatusJs(CookieBootstrap.status(activity))

  @Command
  fun isEngineReady(invoke: Invoke) {
    val ready = EngineBootstrap.isReady()
    val script =
      File(
        File(activity.noBackupFilesDir, "youtubedl-android/yt-dlp"),
        "yt-dlp",
      )
    val python =
      File(activity.applicationInfo.nativeLibraryDir, "libpython.so")
    val ffmpeg =
      File(activity.applicationInfo.nativeLibraryDir, "libffmpeg.so")
    val ok = ready && script.isFile && python.isFile
    val staging = ExportHelper.downloadDir(activity)
    val result = JSObject()
    result.put("ready", ok)
    result.put("ffmpegReady", FfmpegHelper.isReady())
    FfmpegHelper.binDir()?.let { result.put("ffmpegBin", it.absolutePath) }
    result.put("stagingPath", staging.absolutePath)
    if (ok) {
      result.put("ytdlp", script.absolutePath)
      if (ffmpeg.isFile) result.put("ffmpeg", ffmpeg.absolutePath)
      try {
        result.put("version", YoutubeDL.getInstance().version(activity) ?: "")
      } catch (_: Exception) {
        result.put("version", "")
      }
    } else if (EngineBootstrap.lastError != null) {
      result.put("lastError", EngineBootstrap.lastError)
    }
    invoke.resolve(result)
  }

  @Command
  fun awaitReady(invoke: Invoke) {
    val args = invoke.parseArgs(AwaitReadyArgs::class.java)
    val timeoutMs = if (args.timeoutMs > 0) args.timeoutMs else DEFAULT_AWAIT_MS

    executor.execute {
      val ok = EngineBootstrap.awaitReady(timeoutMs)
      if (ok) {
        val result = JSObject()
        result.put("ready", true)
        invoke.resolve(result)
      } else {
        invoke.reject(
          EngineBootstrap.lastError
            ?: "Download engine failed to initialize. Reinstall the app or reboot and try again.",
        )
      }
    }
  }

  /**
   * Fast single-video metadata via AcornYtdlpExecutor (-J).
   * Returns the same shape as execute: { exitCode, out, err } with yt-dlp JSON in out.
   */
  @Command
  fun getInfo(invoke: Invoke) {
    val args = invoke.parseArgs(YtdlpExecuteArgs::class.java)
    val url = args.url.trim()
    if (url.isBlank()) {
      invoke.reject("url required")
      return
    }
    val options = args.options

    executor.execute {
      try {
        val cookieSt = CookieBootstrap.ensureBeforeYtdlp(activity, 20_000L)
        Log.d(
          TAG,
          "getInfo cookies state=${cookieSt.state} exists=${cookieSt.exists}",
        )
        if (!EngineBootstrap.isReady()) {
          if (!EngineBootstrap.awaitReady(DEFAULT_AWAIT_MS)) {
            invoke.reject(
              EngineBootstrap.lastError
                ?: "Download engine failed to initialize. Reinstall the app or reboot and try again.",
            )
            return@execute
          }
        }
        val ffmpegBin = FfmpegHelper.ensureReady(activity)
        val playlistMode =
          options.any {
            it.firstOrNull() == "--flat-playlist" || it.firstOrNull() == "--yes-playlist"
          }
        var lastResponse: AcornYtdlpExecutor.Response? = null
        for (tier in YOUTUBE_CLIENT_TIERS.indices) {
          if (tier > 0) {
            Log.w(TAG, "getInfo bot retry tier=$tier")
            CookieBootstrap.refreshForBotRetry(activity)
            CookieBootstrap.awaitReady(activity, 12_000L)
          }
          val tierRequest = YoutubeDLRequest(url)
          applyOptions(tierRequest, withClientTier(options, tier))
          if (!playlistMode && !options.any { it.firstOrNull() == "--no-playlist" }) {
            tierRequest.addOption("--no-playlist")
          }
          tierRequest.addOption("-J")
          val response =
            AcornYtdlpExecutor.execute(
              activity,
              tierRequest,
              null,
              ffmpegBin,
              null,
              metadataMode = true,
            )
          if (response.exitCode == 0) {
            val result = JSObject()
            result.put("exitCode", response.exitCode)
            result.put("out", response.out)
            result.put("err", response.err)
            invoke.resolve(result)
            return@execute
          }
          lastResponse = response
          if (!isYoutubeBotError(response.out, response.err)) break
        }

        val response = lastResponse ?: throw IllegalStateException("getInfo produced no response")
        val result = JSObject()
        result.put("exitCode", response.exitCode)
        result.put("out", response.out)
        result.put("err", response.err)
        if (response.exitCode != 0) {
          Log.e(TAG, "getInfo failed url=$url cmd=${response.command}")
          val errMsg =
            if (isYoutubeBotError(response.out, response.err)) {
              GUEST_BOT_ERROR_MSG
            } else {
              response.err.ifBlank { "yt-dlp getInfo failed (exit ${response.exitCode})" }
            }
          invoke.reject(errMsg)
          return@execute
        }
        invoke.resolve(result)
      } catch (e: YoutubeDLException) {
        Log.e(TAG, "getInfo failed url=$url", e)
        invoke.reject(e.message ?: "YoutubeDL getInfo error")
      } catch (e: IllegalStateException) {
        Log.e(TAG, "engine not initialized", e)
        invoke.reject(
          EngineBootstrap.lastError
            ?: "Download engine failed to initialize. Reinstall the app or reboot and try again.",
        )
      } catch (e: Exception) {
        Log.e(TAG, "getInfo failed url=$url", e)
        invoke.reject(e.message ?: "getInfo failed")
      }
    }
  }

  @Command
  fun execute(invoke: Invoke) {
    val args = invoke.parseArgs(YtdlpExecuteArgs::class.java)
    val url = args.url.trim()
    if (url.isBlank()) {
      invoke.reject("url required")
      return
    }
    val processId = args.processId
    val options = args.options
    val progressId = processId

    Log.d(TAG, "execute url=${url.take(80)} opts=${options.size}")

    executor.execute {
      try {
        val cookieSt = CookieBootstrap.ensureBeforeYtdlp(activity, 20_000L)
        Log.d(
          TAG,
          "execute cookies state=${cookieSt.state} exists=${cookieSt.exists}",
        )
        if (!EngineBootstrap.isReady()) {
          if (!EngineBootstrap.awaitReady(DEFAULT_AWAIT_MS)) {
            invoke.reject(
              EngineBootstrap.lastError
                ?: "Download engine failed to initialize. Reinstall the app or reboot and try again.",
            )
            return@execute
          }
        }
        val needsFfmpeg = optionsRequireFfmpeg(options)
        val ffmpegBin = FfmpegHelper.ensureReady(activity)
        val ffmpegReady = ffmpegBin != null
        if (needsFfmpeg && !ffmpegReady) {
          val msg =
            "FFmpeg is required for audio extraction but is not available. Reinstall the app and try again."
          writeProgress(progressId, 0.0, null, "error", msg, null)
          invoke.reject(msg)
          return@execute
        }
        if (!ffmpegReady) {
          Log.w(TAG, "ffmpeg CLI unavailable — pre-muxed video may still work")
        }

        val workDir = resolveWorkDir(activity, processId, url)
        Log.d(
          TAG,
          "workDir=${workDir.absolutePath} exportDir=${ExportHelper.downloadDir(activity).absolutePath}",
        )

        writeProgress(progressId, 0.0, null, "downloading", null)

        var attempt: AttemptResult? = null
        for (tier in YOUTUBE_CLIENT_TIERS.indices) {
          if (tier > 0) {
            Log.w(TAG, "execute bot retry tier=$tier")
            CookieBootstrap.refreshForBotRetry(activity)
            CookieBootstrap.awaitReady(activity, 12_000L)
            cleanupPartials(workDir)
          }
          val tierOptions = withClientTier(options, tier)

          // Attempt 1: pre-muxed format from Rust
          var tierAttempt =
            runDownloadAttempt(
              url = url,
              options = tierOptions,
              workDir = workDir,
              processId = processId,
              ffmpegBin = ffmpegBin,
              attemptNum = 1,
              progressId = progressId,
            )

          // Attempt 2: merge format when output missing and ffmpeg ready (skip on bot wall)
          if (
            tierAttempt.savedPath.isNullOrBlank() &&
              ffmpegReady &&
              !tierOptions.any { it.firstOrNull() == "-x" } &&
              !isYoutubeBotError(tierAttempt.response.out, tierAttempt.response.err) &&
              !isYoutubeHardContentError(tierAttempt.response.out, tierAttempt.response.err) &&
              !isRecoverableSidecarError(tierAttempt.response.out, tierAttempt.response.err)
          ) {
            Log.w(TAG, "attempt=1 output missing — retrying with merge format")
            cleanupPartials(workDir)
            val mergeOptions = buildMergeOptions(tierOptions)
            tierAttempt =
              runDownloadAttempt(
                url = url,
                options = mergeOptions,
                workDir = workDir,
                processId = processId,
                ffmpegBin = ffmpegBin,
                attemptNum = 2,
                progressId = progressId,
              )
          }

          attempt = tierAttempt
          if (!tierAttempt.savedPath.isNullOrBlank()) break
          if (!isYoutubeBotError(tierAttempt.response.out, tierAttempt.response.err)) break
        }

        val finalAttempt =
          attempt ?: throw IllegalStateException("execute produced no attempt")
        val result = JSObject()
        result.put("exitCode", finalAttempt.response.exitCode)
        result.put("out", finalAttempt.response.out)
        result.put("err", finalAttempt.response.err)

        if (finalAttempt.response.exitCode != 0 && finalAttempt.savedPath.isNullOrBlank()) {
          Log.e(TAG, "execute failed url=$url cmd=${finalAttempt.response.command}")
          val errMsg =
            if (isYoutubeBotError(finalAttempt.response.out, finalAttempt.response.err)) {
              GUEST_BOT_ERROR_MSG
            } else {
              finalAttempt.response.err.ifBlank {
                "yt-dlp failed (exit ${finalAttempt.response.exitCode})"
              }
            }
          writeProgress(progressId, 0.0, null, "error", errMsg, null)
          invoke.reject(errMsg)
          return@execute
        }

        val savedPath = finalAttempt.savedPath
        if (savedPath.isNullOrBlank()) {
          val stagingFiles =
            workDir.listFiles()?.joinToString { "${it.name}(${it.length()})" } ?: "null"
          val sidecarOnly = isSidecarOnlyStaging(workDir)
          val ffmpegErr = isFfmpegMissing(finalAttempt.response.out, finalAttempt.response.err)
          val msg =
            when {
              ffmpegErr ->
                "FFmpeg is required to merge video and audio but was not found. Reinstall the app or try again."
              sidecarOnly ->
                "Download finished but only thumbnails/metadata were saved (no video file)"
              else -> "Download finished but output file was not found"
            }
          Log.e(
            TAG,
            "output missing dir=${workDir.absolutePath} attempt=${finalAttempt.formatUsed} " +
              "files=$stagingFiles sidecarOnly=$sidecarOnly ffmpegReady=$ffmpegReady " +
              "out=${finalAttempt.response.out.take(800)} err=${finalAttempt.response.err.take(800)}",
          )
          writeProgress(
            progressId,
            0.0,
            null,
            "error",
            "$msg [files=$stagingFiles ffmpeg=$ffmpegReady sidecar=$sidecarOnly]",
            null,
          )
          emitTerminalEvent(processId, "error", null, msg)
          invoke.reject(msg)
          return@execute
        }

        val exported =
          try {
            emitLiveProgress(progressId, 96.0, null, "export")
            exportFinishedFile(activity, savedPath)
          } catch (e: Exception) {
            val staged = File(savedPath)
            ExportHelper.verifyPublicExport(activity, staged, staged.name)?.let { recovered ->
              Log.w(TAG, "export recovered path=$savedPath", e)
              writeProgress(
                progressId,
                100.0,
                null,
                "completed",
                null,
                recovered.destination,
                recovered.mode,
              )
              emitTerminalEvent(processId, "completed", recovered.destination, null, recovered.mode)
              cleanupWorkDir(workDir)
              invoke.resolve(result)
              return@execute
            }
            val msg = e.message ?: "Export to download folder failed"
            Log.e(TAG, "export failed path=$savedPath", e)
            writeProgress(progressId, 0.0, null, "error", msg, null)
            emitTerminalEvent(processId, "error", null, msg)
            invoke.reject(msg)
            return@execute
          }
        writeProgress(progressId, 100.0, null, "completed", null, exported.destination, exported.mode)
        emitTerminalEvent(processId, "completed", exported.destination, null, exported.mode)
        cleanupWorkDir(workDir)
        invoke.resolve(result)
      } catch (e: YoutubeDLException) {
        Log.e(TAG, "execute failed", e)
        writeProgress(progressId, 0.0, null, "error", e.message)
        invoke.reject(e.message ?: "YoutubeDL error")
      } catch (e: IllegalStateException) {
        Log.e(TAG, "engine not initialized", e)
        invoke.reject(
          EngineBootstrap.lastError
            ?: "Download engine still initializing. Wait a moment and try again.",
        )
      } catch (e: Exception) {
        val msg = e.message ?: "execute failed"
        if (msg.contains("cancel", ignoreCase = true) ||
          e.javaClass.simpleName.contains("Cancel", ignoreCase = true)
        ) {
          writeProgress(progressId, 0.0, null, "cancelled", "Cancelled by user")
          invoke.reject("Cancelled by user")
          return@execute
        }
        Log.e(TAG, "execute failed", e)
        invoke.reject(msg)
      }
    }
  }

  /** Run one yt-dlp attempt and resolve the output path. */
  private fun runDownloadAttempt(
    url: String,
    options: List<List<String>>,
    workDir: File,
    processId: String?,
    ffmpegBin: File?,
    attemptNum: Int,
    progressId: String?,
  ): AttemptResult {
    workDir.mkdirs()
    val formatUsed =
      when {
        attemptNum >= 2 -> buildMergeOptions(options).find { it.firstOrNull() == "-f" }?.getOrNull(1)
        else -> resolvePremuxedFormat(options)
      }
    Log.d(TAG, "attempt=$attemptNum format=$formatUsed dir=${workDir.absolutePath}")

    val request = YoutubeDLRequest(url)
    applyOptions(
      request,
      options.filter { entry ->
        entry.firstOrNull() !in downloadBlockedFlags
      },
    )
    request.addOption("-f", formatUsed ?: "bv*+ba/b")
    if (attemptNum >= 2) {
      val container = options.find { it.firstOrNull() == "--merge-output-format" }?.getOrNull(1) ?: "mp4"
      request.addOption("--merge-output-format", container)
    }
    request.addOption(
      "-o",
      File(workDir, "%(title).200B [%(id)s].%(ext)s").absolutePath,
    )
    request.addOption("-P", "home:${workDir.absolutePath}")
    request.addOption("--restrict-filenames")
    request.addOption("--no-simulate")
    request.addOption("--print", "after_move:filepath")
    request.addOption("--print", "filepath")
    request.addOption("--ignore-errors")

    val attemptStart = System.currentTimeMillis()
    val beforeSnapshot = snapshotStaging(workDir)
    var lastProgressPath: String? = null

    val response =
      AcornYtdlpExecutor.execute(
        activity,
        request,
        processId,
        ffmpegBin,
        workDir,
      ) { tick ->
        val pct = tick.percent.toDouble()
        val etaStr = if (tick.etaSec >= 0) "${tick.etaSec}s" else null
        emitLiveProgress(processId, pct, etaStr, tick.phase)
        processId?.let { DownloadOrchestrator.updateItemProgress(it, pct) }
        parseOutputPath(tick.line)?.let { lastProgressPath = it }
      }

    val alreadyDownloaded =
      response.out.contains("has already been downloaded", ignoreCase = true) ||
        response.err.contains("has already been downloaded", ignoreCase = true)
    val sidecarErrorOnly =
      response.exitCode != 0 && isRecoverableSidecarError(response.out, response.err)

    val savedPath =
      finalizePartFiles(workDir)
        ?: findNewMediaFiles(workDir, beforeSnapshot, alreadyDownloaded, attemptStart)
        ?: findNewMediaFilesRecursive(workDir.parentFile, attemptStart)
        ?: findMediaByVideoId(workDir, url, attemptStart)
        ?: resolveInfoJsonPath(workDir)
        ?: resolveJsonStdoutPath(response.out)
        ?: resolveOutputFile(
          workDir,
          activity,
          response.out,
          response.err,
          lastProgressPath,
          attemptStart,
        )
        ?: if (sidecarErrorOnly) findMediaByVideoId(workDir, url, 0L) else null
        ?: finalizePartFiles(workDir)

    return AttemptResult(response, savedPath, formatUsed)
  }

  /** Pre-muxed format for attempt 1; uses Rust -f when present, else 1080 default. */
  private fun resolvePremuxedFormat(options: List<List<String>>): String {
    options.find { it.firstOrNull() == "-f" }?.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }
      ?.let { rustFormat ->
        if (!rustFormat.contains('+')) return rustFormat
      }
    val container =
      options.find { it.firstOrNull() == "--merge-output-format" }?.getOrNull(1) ?: "mp4"
    val height = extractHeightFromFormat(options.find { it.firstOrNull() == "-f" }?.getOrNull(1)) ?: 1080
    return "b[ext=$container]/b[height<=$height]/best[height<=$height][ext=$container]/best[height<=$height]"
  }

  /** Build merge-format options for attempt 2 from Rust-provided options. */
  private fun buildMergeOptions(options: List<List<String>>): List<List<String>> {
    val height =
      extractHeightFromFormat(options.find { it.firstOrNull() == "-f" }?.getOrNull(1)) ?: 1080
    val container =
      options.find { it.firstOrNull() == "--merge-output-format" }?.getOrNull(1) ?: "mp4"
    val mergeFormat = androidMergeFormat(height, container)
    val out = mutableListOf<List<String>>()
    for (entry in options) {
      when (entry.firstOrNull()) {
        "-f", "--merge-output-format" -> continue
        else -> out.add(entry)
      }
    }
    out.add(listOf("-f", mergeFormat))
    out.add(listOf("--merge-output-format", container))
    return out
  }

  /** Merge format string for attempt 2 (requires ffmpeg). */
  private fun androidMergeFormat(height: Int?, container: String): String {
    return if (height != null && height > 0) {
      "bv*[height<=$height]+ba/b[height<=$height]/bv*+ba/b"
    } else {
      "bv*+ba/b"
    }
  }

  /** Extract height cap from a format string or plain digit (144–4320). */
  private fun extractHeightFromFormat(format: String?): Int? {
    if (format.isNullOrBlank()) return null
    val trimmed = format.trim()
    if (trimmed.isNotEmpty() && trimmed.all { it.isDigit() }) {
      val n = trimmed.toIntOrNull() ?: return null
      if (n in 144..4320) return n
      return null
    }
    val match = Regex("""height<=(\d+)""").find(format) ?: return null
    return match.groupValues.getOrNull(1)?.toIntOrNull()?.takeIf { it in 144..4320 }
  }

  /** Remove partial/fragment files before merge retry. */
  private fun cleanupPartials(dir: File) {
    dir.listFiles()?.forEach { file ->
      if (!file.isFile) return@forEach
      val name = file.name.lowercase()
      if (
        name.endsWith(".part") ||
        name.endsWith(".ytdl") ||
        name.contains(".f") ||
        name.endsWith(".temp.mp4") ||
        name.endsWith(".temp.mkv") ||
        name.endsWith(".temp.webm")
      ) {
        file.delete()
      }
    }
  }

  /** True when staging has only sidecar files (thumbnail, json, subs). */
  private fun isSidecarOnlyStaging(dir: File): Boolean {
    val files = dir.listFiles()?.filter { it.isFile && it.length() > 0L } ?: return false
    if (files.isEmpty()) return false
    return files.all { file ->
      file.extension.lowercase() in sidecarExtensions
    }
  }

  private val sidecarExtensions =
    setOf("jpg", "jpeg", "webp", "png", "json", "srt", "vtt", "ass", "description")

  @Command
  fun cancel(invoke: Invoke) {
    val args = invoke.parseArgs(IdArgs::class.java)
    val id = args.id.trim()
    if (id.isBlank()) {
      invoke.reject("id required")
      return
    }
    val destroyed = cancelProcess(id)
    val result = JSObject()
    result.put("destroyed", destroyed)
    invoke.resolve(result)
  }

  /** Cancel an active yt-dlp process by id (orchestrator + UI). */
  fun cancelProcess(id: String): Boolean {
    var destroyed = AcornYtdlpExecutor.destroyProcessById(id)
    if (!destroyed) {
      destroyed =
        try {
          YoutubeDL.getInstance().destroyProcessById(id)
        } catch (e: Exception) {
          Log.w(TAG, "cancel fallback failed", e)
          false
        }
    }
    writeProgress(id, 0.0, null, "cancelled", "Cancelled by user")
    return destroyed
  }

  @Command
  fun getStagingDir(invoke: Invoke) {
    val dir = ExportHelper.downloadDir(activity)
    val result = JSObject()
    result.put("path", dir.absolutePath)
    result.put("exportPath", dir.absolutePath)
    result.put("workPath", ExportHelper.stagingDir(activity).absolutePath)
    invoke.resolve(result)
  }

  /** Export via MediaStore/SAF into Download/Acorn (yt-dlp writes to app-private staging). */
  private fun exportFinishedFile(activity: Activity, savedPath: String): ExportHelper.ExportResult {
    val publicRoot = ExportHelper.downloadDir(activity).absolutePath
    val file = File(savedPath)
    val privateRoot = ExportHelper.stagingDir(activity).absolutePath
    if (savedPath.startsWith(publicRoot) && file.isFile) {
      Log.d(TAG, "download complete in Download/Acorn: $savedPath")
      return ExportHelper.ExportResult(savedPath, file.name, "public")
    }
    if (savedPath.startsWith(privateRoot)) {
      Log.d(TAG, "exporting staged file -> Download/Acorn: $savedPath")
    }
    return ExportHelper.exportFile(activity, savedPath)
  }

  /** App-private per-job folder where yt-dlp writes (rename-safe). */
  private fun resolveWorkDir(activity: Activity, processId: String?, url: String): File {
    val root = ExportHelper.stagingDir(activity)
    val dirName =
      processId?.trim()?.takeIf { it.isNotEmpty() }
        ?: "job-${System.currentTimeMillis()}"
    val workDir = File(root, dirName).also { it.mkdirs() }
    extractVideoId(url)?.let { purgeStaleJobFiles(workDir, it) }
    return workDir
  }

  /** Remove leftover files from a previous failed attempt for the same video. */
  private fun purgeStaleJobFiles(dir: File, videoId: String) {
    dir.listFiles()?.forEach { file ->
      if (file.isFile && file.name.contains(videoId)) {
        try {
          file.delete()
        } catch (_: Exception) {
        }
      }
    }
  }

  /** Manually finalize .part/.ytdl when yt-dlp could not rename on storage. */
  private fun finalizePartFiles(dir: File): String? {
    if (!dir.isDirectory) return null
    val parts =
      dir.listFiles()?.filter { file ->
        file.isFile &&
          file.length() > 0L &&
          (file.name.endsWith(".part") || file.name.endsWith(".ytdl"))
      } ?: return null
    for (part in parts.sortedByDescending { it.length() }) {
      val targetName = part.name.removeSuffix(".part").removeSuffix(".ytdl")
      val target = File(part.parentFile, targetName)
      try {
        if (part.renameTo(target) && target.isFile && target.length() > 0L) {
          Log.d(TAG, "finalized ${part.name} -> ${target.name}")
          return target.absolutePath
        }
        part.inputStream().use { input ->
          target.outputStream().use { output -> input.copyTo(output) }
        }
        part.delete()
        if (target.isFile && target.length() > 0L) {
          Log.d(TAG, "copied ${part.name} -> ${target.name}")
          return target.absolutePath
        }
      } catch (e: Exception) {
        Log.w(TAG, "finalizePartFiles failed for ${part.name}", e)
      }
    }
    return null
  }

  /** Delete app-private staging files after successful export. */
  private fun cleanupWorkDir(dir: File) {
    try {
      dir.listFiles()?.forEach { it.delete() }
      dir.delete()
    } catch (e: Exception) {
      Log.w(TAG, "cleanupWorkDir failed ${dir.absolutePath}", e)
    }
  }

  @Command
  fun readProgress(invoke: Invoke) {
    val args = invoke.parseArgs(IdArgs::class.java)
    val id = args.id.trim()
    if (id.isBlank()) {
      invoke.reject("id required")
      return
    }
    val file = progressFile(id)
    if (!file.isFile) {
      invoke.resolve(JSObject())
      return
    }
    try {
      val raw = file.readText()
      invoke.resolve(JSObject(raw))
    } catch (e: Exception) {
      invoke.resolve(JSObject())
    }
  }

  /** Apply [[flag] | [flag, value], ...] onto a YoutubeDLRequest. */
  private fun applyOptions(request: YoutubeDLRequest, options: List<List<String>>) {
    val merged = mergePoTokenIntoOptions(activity.applicationContext, options)
    for (entry in merged) {
      when (entry.size) {
        1 -> request.addOption(entry[0])
        else -> {
          if (entry.size >= 2) {
            request.addOption(entry[0], entry[1])
          }
        }
      }
    }
  }

  /** Merge PoTokenStore fields into --extractor-args before yt-dlp runs. */
  private fun mergePoTokenIntoOptions(
    context: android.content.Context,
    options: List<List<String>>,
  ): List<List<String>> {
    val poOverlay = PoTokenStore.extractorArgs(context) ?: run {
      Log.d(TAG, "po-token-attached=false (no cached token)")
      return options
    }
    var attached = false
    val merged =
      options.map { entry ->
        if (entry.firstOrNull() == "--extractor-args" && entry.size >= 2) {
          attached = true
          listOf(
            "--extractor-args",
            PoTokenStore.mergeExtractorArgStrings(entry[1], poOverlay),
          )
        } else {
          entry
        }
      }
    if (attached) {
      Log.d(TAG, "po-token-attached=true merged-into-existing")
      return merged
    }
    Log.d(TAG, "po-token-attached=true appended-new")
    return merged + listOf(listOf("--extractor-args", poOverlay))
  }

  /** Replace Rust player_client tier in yt-dlp options for bot retry. */
  private fun withClientTier(options: List<List<String>>, tier: Int): List<List<String>> {
    val idx = tier.coerceIn(0, YOUTUBE_CLIENT_TIERS.lastIndex)
    val poOverlay =
      options
        .find { it.firstOrNull() == "--extractor-args" }
        ?.getOrNull(1)
        ?.let { PoTokenStore.poTokenOverlay(it) }
    var tierArgs = YOUTUBE_CLIENT_TIERS[idx]
    if (!poOverlay.isNullOrBlank()) {
      tierArgs = PoTokenStore.mergeExtractorArgStrings(tierArgs, poOverlay)
    }
    Log.d(TAG, "withClientTier tier=$idx args=${tierArgs.take(120)}")
    val filtered =
      options.filterNot { entry ->
        entry.firstOrNull() == "--extractor-args" &&
          entry.getOrNull(1)?.contains("player_client") == true
      }
    return filtered + listOf(listOf("--extractor-args", tierArgs))
  }

  /** True when yt-dlp options need ffmpeg (audio extract / merge format). */
  private fun optionsRequireFfmpeg(options: List<List<String>>): Boolean {
    if (options.any { it.firstOrNull() == "-x" }) return true
    val format = options.find { it.firstOrNull() == "-f" }?.getOrNull(1).orEmpty()
    return format.contains('+')
  }

  /** True when yt-dlp stderr/stdout mentions missing ffmpeg/ffprobe. */
  private fun isFfmpegMissing(out: String?, err: String?): Boolean {
    val text = "${out.orEmpty()}\n${err.orEmpty()}".lowercase()
    return text.contains("ffmpeg not installed") ||
      text.contains("ffmpeg not found") ||
      text.contains("ffprobe and ffmpeg not found") ||
      text.contains("ffmpeg-location")
  }

  /** True when yt-dlp stderr looks like a YouTube bot / sign-in wall. */
  private fun isYoutubeBotError(out: String?, err: String?): Boolean {
    val text = "${out.orEmpty()}\n${err.orEmpty()}".lowercase()
    return text.contains("sign in to confirm") ||
      text.contains("not a bot") ||
      text.contains("cookies-from-browser") ||
      text.contains("confirm you're not a bot") ||
      text.contains("confirm you are not a bot") ||
      text.contains("please sign in") ||
      text.contains("login required") ||
      text.contains("bot detection") ||
      text.contains("blocked this request") ||
      text.contains("http error 429") ||
      text.contains("too many requests") ||
      text.contains("unable to extract") ||
      text.contains("video unavailable") ||
      text.contains("http error 403") ||
      text.contains("no longer supported") ||
      text.contains("not supported in this application")
  }

  /** True when another client tier may succeed (bot wall, empty file, error 152). */
  private fun isTierRetryableError(out: String?, err: String?): Boolean {
    if (isYoutubeHardContentError(out, err)) return false
    if (isYoutubeBotError(out, err)) return true
    val text = "${out.orEmpty()}\n${err.orEmpty()}".lowercase()
    return text.contains("downloaded file is empty") ||
      text.contains("error code: 152") ||
      text.contains("this video is unavailable")
  }

  /** Premiere, private, or otherwise not downloadable — do not merge-retry. */
  private fun isYoutubeHardContentError(out: String?, err: String?): Boolean {
    val text = "${out.orEmpty()}\n${err.orEmpty()}".lowercase()
    return text.contains("premieres in") ||
      text.contains("premiere") ||
      text.contains("private video") ||
      text.contains("members only") ||
      text.contains("join this channel to get access") ||
      text.contains("not yet available") ||
      text.contains("upcoming")
  }

  /** True when orchestrator should re-queue with backoff (bot, empty, 152). */
  private fun isOrchestratorRetryableError(out: String?, err: String?): Boolean =
    isTierRetryableError(out, err)

  /** True when yt-dlp failed only on sidecar writes (info-json, thumbnail, subs). */
  private fun isRecoverableSidecarError(out: String?, err: String?): Boolean {
    val text = "${out.orEmpty()}\n${err.orEmpty()}"
    val lower = text.lowercase()
    if (lower.contains("cannot write video metadata to json file")) return true
    if (lower.contains(".info.json") && lower.contains("cannot write")) return true
    if (lower.contains("unable to write") && lower.contains(".json")) return true
    return false
  }

  /** Extract YouTube video id from watch/shorts/youtu.be URLs. */
  private fun extractVideoId(url: String): String? {
    val patterns =
      listOf(
        Regex("""(?:v=|/shorts/|youtu\.be/)([\w-]{11})"""),
        Regex("""/embed/([\w-]{11})"""),
      )
    for (pattern in patterns) {
      pattern.find(url)?.groupValues?.getOrNull(1)?.let { return it }
    }
    return null
  }

  /** Find downloaded media in workDir whose filename contains the video id. */
  private fun findMediaByVideoId(dir: File, url: String, sinceMs: Long): String? {
    val id = extractVideoId(url) ?: return null
    if (!dir.isDirectory) return null
    val matches =
      dir.listFiles()?.filter { file ->
        file.isFile &&
          file.length() > 0L &&
          file.name.contains(id) &&
          file.extension.lowercase() in mediaExtensions &&
          (sinceMs <= 0L || file.lastModified() >= sinceMs - 5000L)
      } ?: return null
    if (matches.isEmpty()) return null
    val best = matches.maxByOrNull { it.lastModified() } ?: return null
    finalizeOutputPath(best.absolutePath)?.let { return it }
    return best.absolutePath
  }

  /** Snapshot staging file names and sizes before yt-dlp runs. */
  private fun snapshotStaging(dir: File): Map<String, Long> {
    if (!dir.isDirectory) dir.mkdirs()
    return dir.listFiles()?.associate { it.name to it.length() } ?: emptyMap()
  }

  /** Find new or grown media files in staging after execute (log-independent). */
  private fun findNewMediaFiles(
    dir: File,
    before: Map<String, Long>,
    allowUnchanged: Boolean,
    attemptStartMs: Long,
  ): String? {
    if (!dir.isDirectory) return null
    val after = dir.listFiles() ?: return null
    val candidates =
      after.filter { file ->
        file.isFile &&
          file.length() > 0L &&
          file.extension.lowercase() !in skipExtensions &&
          (
            !before.containsKey(file.name) ||
              file.length() > (before[file.name] ?: 0L) ||
              (allowUnchanged && before.containsKey(file.name)) ||
              (
                file.lastModified() >= attemptStartMs - 2000L &&
                  file.extension.lowercase() in mediaExtensions
              )
          )
      }
    val mediaCandidates = candidates.filter { it.extension.lowercase() in mediaExtensions }
    val picks =
      when {
        mediaCandidates.isNotEmpty() -> {
          val merged =
            mediaCandidates.filter { file ->
              !file.name.contains(".f") && !file.name.contains(".temp.")
            }
          when {
            merged.isNotEmpty() -> merged
            else -> mediaCandidates
          }
        }
        candidates.isNotEmpty() -> candidates
        else -> {
          // Fallback: newest media modified after attempt start
          after
            .filter { file ->
              file.isFile &&
                file.length() > 0L &&
                file.extension.lowercase() in mediaExtensions &&
                file.lastModified() >= attemptStartMs - 2000L
            }
            .sortedByDescending { it.lastModified() }
        }
      }
    if (picks.isEmpty()) return null
    val list = if (picks is List<*>) picks.filterIsInstance<File>() else emptyList()
    val best = list.maxByOrNull { it.length() } ?: return null
    finalizeOutputPath(best.absolutePath)?.let { return it }
    return best.absolutePath
  }

  /** Read filepath from newest .info.json in staging. */
  private fun resolveInfoJsonPath(staging: File): String? {
    val jsonFiles =
      staging.listFiles()
        ?.filter { it.isFile && it.name.endsWith(".info.json") }
        ?.sortedByDescending { it.lastModified() }
        ?: return null
    for (jsonFile in jsonFiles) {
      try {
        val obj = JSONObject(jsonFile.readText())
        listOf("_filename", "filename").forEach { key ->
          val top = obj.optString(key, "").trim()
          if (top.isNotEmpty()) {
            resolveMediaPath(top)?.let { return it }
          }
        }
        val downloads = obj.optJSONArray("requested_downloads") ?: continue
        if (downloads.length() == 0) continue
        val first = downloads.getJSONObject(0)
        val path = first.optString("filepath", "").trim()
        if (path.isNotEmpty()) {
          resolveMediaPath(path)?.let { return it }
        }
      } catch (e: Exception) {
        Log.w(TAG, "info-json parse failed ${jsonFile.name}", e)
      }
    }
    return null
  }

  /** Return path if file exists and is non-empty media. */
  private fun resolveMediaPath(raw: String): String? {
    val file = File(raw)
    if (file.isFile && file.length() > 0L && file.extension.lowercase() in mediaExtensions) {
      return file.absolutePath
    }
    return finalizeOutputPath(raw)
  }

  /** Parse a finished media path from yt-dlp stdout/stderr or a single progress line. */
  private fun parseOutputPath(output: String?): String? {
    if (output.isNullOrBlank()) return null
    val patterns =
      listOf(
        Regex("""\[download\]\s+Destination:\s+(.+)"""),
        Regex("""\[ExtractAudio\]\s+Destination:\s+(.+)"""),
        Regex("""\[Merger\]\s+Merging formats into "(.+?)""""),
        Regex("""\[MoveFiles\]\s+Moving file "(.+?)""""),
        Regex("""\[download\]\s+(.+?) has already been downloaded"""),
        Regex("""\[FixupM3u8\]\s+Fixing M3U8 live restreaming timestamps of "(.+?)""""),
        Regex("""\[ffmpeg\]\s+Merging formats into "(.+?)""""),
      )
    for (line in output.lines()) {
      for (pattern in patterns) {
        val match = pattern.find(line.trim()) ?: continue
        val raw = match.groupValues.getOrNull(1)?.trim()?.trim('"') ?: continue
        resolveMediaPath(raw)?.let { return it }
      }
    }
    return null
  }

  private val mergedExtensions =
    listOf("mp4", "webm", "mkv", "m4a", "mp3", "opus", "flac", "wav")
  private val mediaExtensions =
    setOf("mp4", "webm", "mkv", "mp3", "m4a", "opus", "wav", "flac", "avi", "mov", "m4v", "aac", "ogg")
  private val skipExtensions =
    setOf("part", "ytdl", "temp", "frag", "srt", "vtt", "ass", "jpg", "jpeg", "webp", "png", "description", "json")

  /** Prefer merged output when yt-dlp left a fragment or temp path. */
  private fun finalizeOutputPath(raw: String): String? {
    val path = File(raw)
    if (path.isFile && path.length() > 0L) {
      if (path.name.contains(".temp.")) {
        val withoutTemp = path.name.replace(".temp.", ".")
        val sibling = File(path.parentFile, withoutTemp)
        if (sibling.isFile && sibling.length() > 0L) return sibling.absolutePath
      }
      return path.absolutePath
    }
    val parent = path.parentFile ?: return null
    val name = path.name
    val lastDot = name.lastIndexOf('.')
    val stem = if (lastDot > 0) name.substring(0, lastDot) else name
    val dotF = stem.lastIndexOf(".f")
    val base =
      if (dotF >= 0) {
        val rest = stem.substring(dotF + 2)
        if (rest.isNotEmpty() && rest.all { it.isDigit() }) stem.substring(0, dotF) else stem
      } else {
        stem.replace(".temp", "")
      }
    for (ext in mergedExtensions) {
      val candidate = File(parent, "$base.$ext")
      if (candidate.isFile && candidate.length() > 0L) return candidate.absolutePath
    }
    // Check .temp.* siblings from merge/post-process (#8203 follow-up)
    for (ext in mergedExtensions) {
      val temp = File(parent, "$base.temp.$ext")
      if (temp.isFile && temp.length() > 0L) return temp.absolutePath
    }
    val entries = parent.listFiles() ?: return null
    for (entry in entries) {
      if (!entry.isFile || entry.length() <= 0L) continue
      val entryName = entry.name
      if (
        entryName.startsWith(base) &&
        !entryName.contains(".f") &&
        !entryName.endsWith(".part") &&
        !entryName.endsWith(".ytdl")
      ) {
        return entry.absolutePath
      }
    }
    return null
  }

  /** Pick the newest media file in staging after execute completes. */
  private fun findNewestMediaFile(dir: File, sinceMs: Long = 0L): String? {
    if (!dir.isDirectory) return null
    val files =
      dir.listFiles()?.filter { file ->
        file.isFile &&
          file.length() > 0L &&
          file.extension.lowercase() !in skipExtensions &&
          (sinceMs <= 0L || file.lastModified() >= sinceMs - 2000L)
      } ?: return null
    if (files.isEmpty()) return null
    val merged =
      files.filter { file ->
        file.extension.lowercase() in mediaExtensions &&
          !file.name.contains(".f") &&
          !file.name.contains(".temp.")
      }
    val media = files.filter { it.extension.lowercase() in mediaExtensions }
    val candidates =
      when {
        merged.isNotEmpty() -> merged
        media.isNotEmpty() -> media
        else -> files
      }
    val newest = candidates.maxByOrNull { it.lastModified() }
    newest?.absolutePath?.let { path ->
      finalizeOutputPath(path)?.let { return it }
      return path
    }
    for (file in files.sortedByDescending { it.lastModified() }) {
      finalizeOutputPath(file.absolutePath)?.let { return it }
    }
    return null
  }

  /** Resolve output path from yt-dlp logs, with staging dir fallback + retries for merge. */
  private fun resolveOutputFile(
    staging: File,
    activity: Activity,
    out: String?,
    err: String?,
    progressPath: String? = null,
    attemptStartMs: Long = 0L,
  ): String? {
    progressPath?.let { path ->
      resolveMediaPath(path)?.let { return it }
    }
    parsePrintOutput(activity, out, err)?.let { return it }
    parseOutputPath(out)?.let { return it }
    parseOutputPath(err)?.let { return it }
    if (!staging.isDirectory) staging.mkdirs()
    repeat(20) { attempt ->
      findNewestMediaFile(staging, attemptStartMs)?.let { return it }
      if (attempt < 19) Thread.sleep(500)
    }
    return findLargestFragment(staging)
  }

  /** Parse --print filepath lines from stdout/stderr under app dirs. */
  private fun parsePrintOutput(activity: Activity, out: String?, err: String?): String? {
    val roots =
      listOfNotNull(
        activity.filesDir.absolutePath,
        activity.cacheDir.absolutePath,
        activity.codeCacheDir.absolutePath,
        activity.noBackupFilesDir.absolutePath,
        activity.getExternalFilesDir(null)?.absolutePath,
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)?.absolutePath,
      )
    for (output in listOf(out, err)) {
      if (output.isNullOrBlank()) continue
      for (line in output.lines().asReversed()) {
        val trimmed = line.trim().trim('"')
        if (!trimmed.startsWith("/")) continue
        if (roots.none { trimmed.startsWith(it) }) continue
        resolveMediaPath(trimmed)?.let { return it }
      }
    }
    return null
  }

  /** Parse yt-dlp JSON stdout (-J / --print) for _filename or requested_downloads.filepath. */
  private fun resolveJsonStdoutPath(out: String?): String? {
    if (out.isNullOrBlank()) return null
    val trimmed = out.trim()
    if (!trimmed.startsWith("{")) return null
    return try {
      val obj = JSONObject(trimmed)
      listOf("_filename", "filename").forEach { key ->
        val top = obj.optString(key, "").trim()
        if (top.isNotEmpty()) {
          resolveMediaPath(top)?.let { return it }
        }
      }
      val downloads = obj.optJSONArray("requested_downloads") ?: return null
      for (i in 0 until downloads.length()) {
        val entry = downloads.optJSONObject(i) ?: continue
        val path = entry.optString("filepath", "").trim()
        if (path.isNotEmpty()) {
          resolveMediaPath(path)?.let { return it }
        }
      }
      null
    } catch (e: Exception) {
      Log.w(TAG, "json stdout parse failed", e)
      null
    }
  }

  /** Search staging parent recursively when output landed outside workDir. */
  private fun findNewMediaFilesRecursive(root: File?, attemptStartMs: Long): String? {
    if (root == null || !root.isDirectory) return null
    val candidates =
      root.walkTopDown().maxDepth(3).filter { file ->
        file.isFile &&
          file.length() > 0L &&
          file.extension.lowercase() in mediaExtensions &&
          file.lastModified() >= attemptStartMs - 2000L &&
          !file.name.contains(".f") &&
          !file.name.endsWith(".part") &&
          !file.name.contains(".temp.")
      }.toList()
    val best = candidates.maxByOrNull { it.length() } ?: return null
    return finalizeOutputPath(best.absolutePath) ?: best.absolutePath
  }

  /** Last resort: largest video fragment when merge did not produce a final file. */
  private fun findLargestFragment(dir: File): String? {
    if (!dir.isDirectory) return null
    val videoExts = setOf("mp4", "webm", "mkv", "m4v", "mov", "avi")
    return dir.listFiles()
      ?.filter { file ->
        file.isFile &&
          file.length() > 1024L &&
          file.extension.lowercase() in videoExts
      }
      ?.maxByOrNull { it.length() }
      ?.absolutePath
  }

  /** Emit a live download-progress event with optional processing phase. */
  private fun emitLiveProgress(
    processId: String?,
    percent: Double,
    eta: String?,
    phase: String?,
  ) {
    if (processId.isNullOrBlank()) return
    writeProgress(processId, percent, eta, "downloading", null, null, null, phase)
    try {
      val event = JSObject()
      event.put("id", processId)
      event.put("percent", percent)
      if (eta != null) event.put("eta", eta)
      event.put("status", "downloading")
      if (phase != null) event.put("phase", phase)
      trigger("download-progress", event)
    } catch (_: Exception) {
    }
  }

  /** Emit a terminal download-progress event (completed or error). */
  private fun emitTerminalEvent(
    processId: String?,
    status: String,
    filename: String?,
    error: String?,
    exportMode: String? = null,
  ) {
    if (processId.isNullOrBlank()) return
    try {
      val event = JSObject()
      event.put("id", processId)
      event.put("percent", if (status == "completed") 100.0 else 0.0)
      event.put("status", status)
      if (filename != null) event.put("filename", filename)
      if (error != null) event.put("error", error)
      if (exportMode != null) event.put("exportMode", exportMode)
      Log.d(TAG, "emit download-progress id=$processId status=$status")
      trigger("download-progress", event)
    } catch (_: Exception) {
    }
  }

  /** Persist progress for Rust polling while execute blocks. */
  private fun writeProgress(
    id: String?,
    percent: Double,
    eta: String?,
    status: String,
    error: String?,
    filename: String? = null,
    exportMode: String? = null,
    phase: String? = null,
  ) {
    if (id.isNullOrBlank()) return
    try {
      val obj = JSObject()
      obj.put("id", id)
      obj.put("percent", percent)
      if (eta != null) obj.put("eta", eta)
      obj.put("status", status)
      if (error != null) obj.put("error", error)
      if (filename != null) obj.put("filename", filename)
      if (exportMode != null) obj.put("exportMode", exportMode)
      if (phase != null) obj.put("phase", phase)
      progressFile(id).writeText(obj.toString())
    } catch (e: Exception) {
      Log.w(TAG, "progress write failed", e)
    }
  }

  private fun progressFile(id: String): File {
    val dir = File(activity.cacheDir, "acorn-progress")
    if (!dir.exists()) dir.mkdirs()
    return File(dir, "$id.json")
  }

  /** Blocking download entry for DownloadOrchestrator (background thread). */
  fun runDownloadBlocking(
    host: Activity,
    url: String,
    options: List<List<String>>,
    processId: String?,
  ): BlockingDownloadResult {
    val progressId = processId
    try {
      CookieBootstrap.ensureBeforeYtdlp(host, 20_000L)
      if (!EngineBootstrap.isReady() && !EngineBootstrap.awaitReady(DEFAULT_AWAIT_MS)) {
        return BlockingDownloadResult(
          success = false,
          error = EngineBootstrap.lastError ?: "Engine not ready",
          filename = null,
          exportMode = null,
          botError = false,
          cancelled = false,
        )
      }
      val needsFfmpeg = optionsRequireFfmpeg(options)
      val ffmpegBin = FfmpegHelper.ensureReady(host)
      val ffmpegReady = ffmpegBin != null
      if (needsFfmpeg && !ffmpegReady) {
        val msg = "FFmpeg is required for audio extraction but is not available."
        writeProgress(progressId, 0.0, null, "error", msg, null)
        emitTerminalEvent(progressId, "error", null, msg)
        return BlockingDownloadResult(false, msg, null, null, false, false)
      }
      val workDir = resolveWorkDir(host, processId, url)
      writeProgress(progressId, 0.0, null, "downloading", null)
      var attempt: AttemptResult? = null
      for (tier in YOUTUBE_CLIENT_TIERS.indices) {
        if (tier > 0) {
          val cookieFile = CookieBootstrap.cookiesPath(host)
          if (!CookieBootstrap.isAuthenticated(cookieFile)) {
            val tierWaitMs = 20_000L + kotlin.random.Random.nextLong(21_000L)
            Log.d(TAG, "guest-tier-pause ${tierWaitMs}ms tier=$tier")
            Thread.sleep(tierWaitMs)
          }
          Log.w(TAG, "runDownloadBlocking bot retry tier=$tier url=$url")
          CookieBootstrap.refreshForBotRetry(host)
          CookieBootstrap.awaitReady(host, 12_000L)
          cleanupPartials(workDir)
        }
        val tierOptions = withClientTier(options, tier)
        var tierAttempt =
          runDownloadAttempt(
            url = url,
            options = tierOptions,
            workDir = workDir,
            processId = processId,
            ffmpegBin = ffmpegBin,
            attemptNum = 1,
            progressId = progressId,
          )
        if (
          tierAttempt.savedPath.isNullOrBlank() &&
            ffmpegReady &&
            !tierOptions.any { it.firstOrNull() == "-x" } &&
            !isYoutubeBotError(tierAttempt.response.out, tierAttempt.response.err) &&
            !isYoutubeHardContentError(tierAttempt.response.out, tierAttempt.response.err) &&
            !isRecoverableSidecarError(tierAttempt.response.out, tierAttempt.response.err)
        ) {
          cleanupPartials(workDir)
          tierAttempt =
            runDownloadAttempt(
              url = url,
              options = buildMergeOptions(tierOptions),
              workDir = workDir,
              processId = processId,
              ffmpegBin = ffmpegBin,
              attemptNum = 2,
              progressId = progressId,
            )
        }
        attempt = tierAttempt
        if (!tierAttempt.savedPath.isNullOrBlank()) break
        if (!isTierRetryableError(tierAttempt.response.out, tierAttempt.response.err)) break
        Log.w(
          TAG,
          "runDownloadBlocking tier=$tier retryable-error err=${tierAttempt.response.err?.take(200)}",
        )
      }
      val finalAttempt = attempt ?: return BlockingDownloadResult(false, "No attempt", null, null, false, false)
      if (finalAttempt.response.exitCode != 0 && finalAttempt.savedPath.isNullOrBlank()) {
        val errMsg =
          if (isYoutubeBotError(finalAttempt.response.out, finalAttempt.response.err)) {
            GUEST_BOT_ERROR_MSG
          } else {
            finalAttempt.response.err.ifBlank { "yt-dlp failed" }
          }
        writeProgress(progressId, 0.0, null, "error", errMsg, null)
        emitTerminalEvent(progressId, "error", null, errMsg)
        return BlockingDownloadResult(
          false,
          errMsg,
          null,
          null,
          isOrchestratorRetryableError(finalAttempt.response.out, finalAttempt.response.err),
          false,
        )
      }
      val savedPath = finalAttempt.savedPath
      if (savedPath.isNullOrBlank()) {
        val msg = "Download finished but output file was not found"
        writeProgress(progressId, 0.0, null, "error", msg, null)
        emitTerminalEvent(progressId, "error", null, msg)
        return BlockingDownloadResult(false, msg, null, null, false, false)
      }
      val exported =
        try {
          emitLiveProgress(progressId, 96.0, null, "export")
          exportFinishedFile(host, savedPath)
        } catch (e: Exception) {
          val staged = File(savedPath)
          ExportHelper.verifyPublicExport(host, staged, staged.name)?.let { recovered ->
            writeProgress(progressId, 100.0, null, "completed", null, recovered.destination, recovered.mode)
            emitTerminalEvent(progressId, "completed", recovered.destination, null, recovered.mode)
            cleanupWorkDir(workDir)
            return BlockingDownloadResult(true, null, recovered.destination, recovered.mode, false, false)
          }
          val msg = e.message ?: "Export failed"
          writeProgress(progressId, 0.0, null, "error", msg, null)
          emitTerminalEvent(progressId, "error", null, msg)
          return BlockingDownloadResult(false, msg, null, null, false, false)
        }
      writeProgress(progressId, 100.0, null, "completed", null, exported.destination, exported.mode)
      emitTerminalEvent(progressId, "completed", exported.destination, null, exported.mode)
      cleanupWorkDir(workDir)
      return BlockingDownloadResult(true, null, exported.destination, exported.mode, false, false)
    } catch (e: Exception) {
      val msg = e.message ?: "Download error"
      if (msg.contains("cancel", ignoreCase = true)) {
        writeProgress(progressId, 0.0, null, "cancelled", msg, null)
        return BlockingDownloadResult(false, msg, null, null, false, true)
      }
      writeProgress(progressId, 0.0, null, "error", msg, null)
      emitTerminalEvent(progressId, "error", null, msg)
      return BlockingDownloadResult(false, msg, null, null, false, false)
    }
  }
}

/** Result of a blocking download for the native orchestrator. */
data class BlockingDownloadResult(
  val success: Boolean,
  val error: String?,
  val filename: String?,
  val exportMode: String?,
  val botError: Boolean,
  val cancelled: Boolean,
)
