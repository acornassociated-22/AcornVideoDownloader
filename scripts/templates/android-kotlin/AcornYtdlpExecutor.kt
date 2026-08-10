package com.acorn.videodownloader

import android.content.Context
import android.util.Log
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * Custom yt-dlp ProcessBuilder with correct --ffmpeg-location (directory with ffmpeg+ffprobe).
 * Avoids youtubedl-android passing libffmpeg.so which breaks ffprobe lookup.
 */
object AcornYtdlpExecutor {
  private const val TAG = "AcornYtdlpExecutor"

  data class Response(
    val exitCode: Int,
    val out: String,
    val err: String,
    val command: String,
  )

  /** Progress tick with remapped percent and processing phase. */
  data class ProgressTick(
    val percent: Float,
    val etaSec: Long,
    val line: String,
    val phase: String,
  )

  private val idProcessMap =
    Collections.synchronizedMap(ConcurrentHashMap<String, Process>())

  /** Strip flags that dump JSON / skip downloading. */
  private fun sanitizeDownloadArgs(raw: List<String>): List<String> {
    val blocked =
      setOf(
        "-J",
        "--dump-single-json",
        "--dump-json",
        "--flat-playlist",
        "--simulate",
        "--skip-download",
      )
    return raw.filter { it !in blocked }
  }

  /** Run yt-dlp with optional progress callback and cancel id. */
  @Throws(YoutubeDLException::class, InterruptedException::class)
  fun execute(
    context: Context,
    request: YoutubeDLRequest,
    processId: String?,
    ffmpegBinDir: File?,
    workDir: File?,
    metadataMode: Boolean = false,
    callback: ((ProgressTick) -> Unit)? = null,
  ): Response {
    val env = readYoutubeDLEnv(context)
    if (!request.hasOption("--cache-dir") || request.getOption("--cache-dir") == null) {
      request.addOption("--no-cache-dir")
    }
    val quickJs = File(context.applicationInfo.nativeLibraryDir, "libqjs.so")
    if (quickJs.isFile) {
      request.addOption("--js-runtimes", "quickjs:${quickJs.absolutePath}")
      request.addOption("--remote-components", "ejs:github")
    }
    if (ffmpegBinDir != null && ffmpegBinDir.isDirectory) {
      request.addOption("--ffmpeg-location", ffmpegBinDir.absolutePath)
      Log.d(TAG, "ffmpeg-location=${ffmpegBinDir.absolutePath}")
    }
    attachCookiesIfNeeded(context, request)
    attachPoTokenIfNeeded(context, request)
    val args =
      if (metadataMode) {
        request.buildCommand()
      } else {
        sanitizeDownloadArgs(request.buildCommand())
      }
    val command = mutableListOf(env.python.absolutePath, env.ytdlp.absolutePath)
    command.addAll(args)
    if (
      !metadataMode &&
        args.any { it == "-J" || it == "--dump-single-json" || it == "--dump-json" }
    ) {
      Log.e(TAG, "refusing JSON-only yt-dlp command (would skip download)")
      throw YoutubeDLException("Internal error: metadata flags in download command")
    }
    val processBuilder =
      ProcessBuilder(command)
        .redirectErrorStream(false)
    if (workDir != null) {
      workDir.mkdirs()
      processBuilder.directory(workDir)
    }
    Log.d(TAG, "full-cmd=${command.joinToString(" ")}")
    applyProcessEnv(context, processBuilder, env)
    val process =
      try {
        processBuilder.start()
      } catch (e: Exception) {
        throw YoutubeDLException(e)
      }
    if (!processId.isNullOrBlank()) {
      idProcessMap[processId] = process
    }
    val outBuffer = StringBuilder()
    val errBuffer = StringBuilder()
    val stdoutThread =
      Thread {
        BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
          var line: String?
          while (reader.readLine().also { line = it } != null) {
            val text = line ?: continue
            outBuffer.append(text).append('\n')
            parseProgressLine(text)?.let { (pct, eta) ->
              callback?.invoke(
                ProgressTick(mapDownloadPercent(pct), eta, text, "download"),
              )
            }
          }
        }
      }
    val stderrThread =
      Thread {
        BufferedReader(InputStreamReader(process.errorStream)).use { reader ->
          var line: String?
          while (reader.readLine().also { line = it } != null) {
            val text = line ?: continue
            errBuffer.append(text).append('\n')
            parsePhaseLine(text)?.let { tick -> callback?.invoke(tick) }
          }
        }
      }
    stdoutThread.start()
    stderrThread.start()
    val exitCode =
      try {
        stdoutThread.join()
        stderrThread.join()
        process.waitFor()
      } catch (e: InterruptedException) {
        process.destroy()
        if (!processId.isNullOrBlank()) idProcessMap.remove(processId)
        throw e
      }
    if (!processId.isNullOrBlank()) {
      idProcessMap.remove(processId)
    }
    if (exitCode != 0) {
      Log.w(TAG, "yt-dlp exit=$exitCode err=${errBuffer.toString().take(400)}")
    }
    return Response(
      exitCode = exitCode,
      out = outBuffer.toString(),
      err = errBuffer.toString(),
      command = command.joinToString(" "),
    )
  }

  /** Cancel a running process by id. */
  fun destroyProcessById(id: String): Boolean {
    val process = idProcessMap.remove(id) ?: return false
    return try {
      process.destroy()
      true
    } catch (e: Exception) {
      Log.w(TAG, "destroyProcessById failed", e)
      false
    }
  }

  /** Run yt-dlp --version with full embedded Python env (optional script override). */
  fun runVersionCheck(context: Context, ytdlpOverride: File? = null): String? {
    return try {
      val env = readYoutubeDLEnv(context)
      val ytdlp = ytdlpOverride ?: env.ytdlp
      if (!ytdlp.isFile) return null
      val processBuilder =
        ProcessBuilder(env.python.absolutePath, ytdlp.absolutePath, "--version")
          .redirectErrorStream(true)
      applyProcessEnv(context, processBuilder, env)
      val process = processBuilder.start()
      val output =
        BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
          reader.readText().trim()
        }
      val exit = process.waitFor()
      Log.d(TAG, "runVersionCheck exit=$exit output=$output file=${ytdlp.name}")
      if (exit == 0 && output.isNotBlank()) output else null
    } catch (e: Exception) {
      Log.w(TAG, "runVersionCheck failed", e)
      null
    }
  }

  /** True when the installed yt-dlp script runs under embedded Python. */
  fun verifyYtdlpScript(context: Context): Boolean = runVersionCheck(context) != null

  /** Apply PYTHONHOME/LD_LIBRARY_PATH env used for yt-dlp subprocesses. */
  private fun applyProcessEnv(
    context: Context,
    processBuilder: ProcessBuilder,
    env: YoutubeDLEnv,
  ) {
    processBuilder.environment().apply {
      put("LD_LIBRARY_PATH", FfmpegHelper.buildLdLibraryPath(context))
      put("SSL_CERT_FILE", env.sslCertFile)
      put("PATH", (System.getenv("PATH") ?: "") + ":" + env.binDir.absolutePath)
      put("PYTHONHOME", env.pythonHome)
      put("HOME", env.pythonHome)
      put("TMPDIR", env.tmpDir)
    }
  }

  private data class YoutubeDLEnv(
    val python: File,
    val ytdlp: File,
    val binDir: File,
    val ldLibraryPath: String,
    val sslCertFile: String,
    val pythonHome: String,
    val tmpDir: String,
  )

  /** Read initialized paths/env from YoutubeDL via reflection. */
  private fun readYoutubeDLEnv(context: Context): YoutubeDLEnv {
    YoutubeDL.getInstance().init(context)
    val clazz = Class.forName("com.yausername.youtubedl_android.YoutubeDL")
    val instance = clazz.getDeclaredField("INSTANCE").get(null)
    fun field(name: String): Any? {
      val f = clazz.getDeclaredField(name)
      f.isAccessible = true
      return f.get(instance)
    }
    val python = field("pythonPath") as? File
    val ytdlp = field("ytdlpPath") as? File
    val binDir = field("binDir") as? File
    val ld = field("ENV_LD_LIBRARY_PATH") as? String ?: ""
    val ssl = field("ENV_SSL_CERT_FILE") as? String ?: ""
    val pyHome = field("ENV_PYTHONHOME") as? String ?: ""
    val tmp = field("TMPDIR") as? String ?: context.cacheDir.absolutePath
    if (python == null || !python.isFile || ytdlp == null || !ytdlp.isFile || binDir == null) {
      throw IllegalStateException("YoutubeDL not initialized")
    }
    return YoutubeDLEnv(python, ytdlp, binDir, ld, ssl, pyHome, tmp)
  }

  /** Append --cookies when a valid cookie file exists and yt-dlp has no cookie flag yet. */
  private fun attachCookiesIfNeeded(context: Context, request: YoutubeDLRequest) {
    if (request.hasOption("--cookies")) return
    val cookieFile = CookieBootstrap.cookiesPath(context)
    if (!cookieFile.isFile || cookieFile.length() == 0L) {
      Log.d(TAG, "cookies-attached=false")
      return
    }
    request.addOption("--cookies", cookieFile.absolutePath)
    Log.d(
      TAG,
      "cookies-attached=true authenticated=${CookieBootstrap.isAuthenticated(cookieFile)} path=${cookieFile.absolutePath}",
    )
  }

  /** Append PO token when no extractor-args yet (merge path lives in YtdlpPlugin.applyOptions). */
  private fun attachPoTokenIfNeeded(context: Context, request: YoutubeDLRequest) {
    if (request.hasOption("--extractor-args")) return
    val poArgs = PoTokenStore.extractorArgs(context) ?: return
    request.addOption("--extractor-args", poArgs)
    Log.d(TAG, "po-token-attached=true")
  }

  /** Map raw yt-dlp download percent into 0–75% UI range. */
  private fun mapDownloadPercent(raw: Float): Float = (raw * 0.75f).coerceIn(0f, 75f)

  /** Detect merge/convert/ffmpeg phases from stderr lines. */
  private fun parsePhaseLine(line: String): ProgressTick? {
    val trimmed = line.trim()
    return when {
      trimmed.contains("[Merger]") ->
        ProgressTick(80f, -1L, line, "merge")
      trimmed.contains("[ExtractAudio]") ->
        ProgressTick(91f, -1L, line, "convert")
      trimmed.contains("[ffmpeg]") || trimmed.contains("[PostProcessor]") ->
        ProgressTick(85f, -1L, line, "merge")
      else -> null
    }
  }

  /** Parse [download] progress line into percent and eta seconds. */
  private fun parseProgressLine(line: String): Pair<Float, Long>? {
    val pctMatch = Regex("""(\d+(?:\.\d+)?)\s*%\s*""").find(line) ?: return null
    val pct = pctMatch.groupValues[1].toFloatOrNull() ?: return null
    val etaMatch = Regex("""ETA\s+(\d+):(\d+)""").find(line)
    val etaSec =
      if (etaMatch != null) {
        val m = etaMatch.groupValues[1].toLongOrNull() ?: 0L
        val s = etaMatch.groupValues[2].toLongOrNull() ?: 0L
        m * 60 + s
      } else {
        -1L
      }
    return pct to etaSec
  }
}
