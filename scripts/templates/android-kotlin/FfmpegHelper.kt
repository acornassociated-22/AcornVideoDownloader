package com.acorn.videodownloader

import android.content.Context
import android.system.Os
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import java.io.File
import java.io.IOException

/**
 * yt-dlp expects ffmpeg/ffprobe CLI names; youtubedl-android ships libffmpeg.so / libffprobe.so.
 * Symlink (or copy to codeCacheDir) for AcornYtdlpExecutor --ffmpeg-location.
 */
object FfmpegHelper {
  private const val TAG = "FfmpegHelper"
  private const val BIN_DIR_NAME = "acorn-ffmpeg-bin"
  /** r-xr-xr-x — drop write bit so Android W^X allows exec from code_cache. */
  private const val EXEC_MODE = 365

  @Volatile
  private var verifiedBinDir: File? = null

  /** True when CLI-named ffmpeg/ffprobe exist and respond to -version. */
  fun isReady(): Boolean = verifiedBinDir != null

  /** Cached bin directory after successful verification. */
  fun binDir(): File? = verifiedBinDir

  /** LD_LIBRARY_PATH with nativeLibraryDir prepended for ffmpeg .so copies. */
  fun buildLdLibraryPath(context: Context): String {
    val nativeDir = context.applicationInfo.nativeLibraryDir
    val ytdlpLd = readLdLibraryPath(context).orEmpty()
    return when {
      ytdlpLd.isBlank() -> nativeDir
      ytdlpLd.contains(nativeDir) -> ytdlpLd
      else -> "$nativeDir:$ytdlpLd"
    }
  }

  /** Ensure FFmpeg package is unpacked, CLI binaries exist, and respond to -version. */
  fun ensureReady(context: Context): File? {
    return try {
      FFmpeg.getInstance().init(context)
      val bin = ensureCliBinaries(context) ?: return null
      verifyCli(context, bin)
    } catch (e: Exception) {
      Log.w(TAG, "FFmpeg init failed", e)
      val bin = ensureCliBinaries(context) ?: return null
      verifyCli(context, bin)
    }
  }

  /** Prepare {ffmpeg,ffprobe} in codeCacheDir — symlink to native .so when possible. */
  fun ensureCliBinaries(context: Context): File? {
    val nativeDir = File(context.applicationInfo.nativeLibraryDir)
    val srcFfmpeg = File(nativeDir, "libffmpeg.so")
    val srcFfprobe = File(nativeDir, "libffprobe.so")
    if (!srcFfmpeg.isFile || !srcFfprobe.isFile) {
      Log.w(TAG, "native ffmpeg missing ffmpeg=${srcFfmpeg.isFile} ffprobe=${srcFfprobe.isFile}")
      verifiedBinDir = null
      return null
    }

    removeLegacyCacheBin(context)

    val binDir = File(context.codeCacheDir, BIN_DIR_NAME).also { it.mkdirs() }
    val ffmpeg = File(binDir, "ffmpeg")
    val ffprobe = File(binDir, "ffprobe")
    if (!ensureCliEntry(srcFfmpeg, ffmpeg) || !ensureCliEntry(srcFfprobe, ffprobe)) {
      Log.w(TAG, "ffmpeg CLI entries could not be prepared")
      verifiedBinDir = null
      return null
    }
    return binDir
  }

  /** Run ffmpeg -version with YoutubeDL LD_LIBRARY_PATH + nativeLibraryDir. */
  private fun verifyCli(context: Context, binDir: File): File? {
    val ffmpeg = File(binDir, "ffmpeg")
    if (!ffmpeg.isFile) {
      verifiedBinDir = null
      return null
    }
    val ldPath = buildLdLibraryPath(context)
    return try {
      val process = startFfmpegProcess(ffmpeg, ldPath, listOf("-version"))
      val output = process.inputStream.bufferedReader().readText()
      val exit = process.waitFor()
      if (exit != 0 || !output.contains("ffmpeg", ignoreCase = true)) {
        Log.w(TAG, "ffmpeg -version failed exit=$exit out=${output.take(120)}")
        verifiedBinDir = null
        null
      } else {
        verifiedBinDir = binDir
        Log.i(TAG, "ffmpeg verified binDir=${binDir.absolutePath}")
        binDir
      }
    } catch (e: Exception) {
      Log.w(TAG, "ffmpeg verification failed", e)
      verifiedBinDir = null
      null
    }
  }

  /** Prefer symlink into nativeLibraryDir (executable SELinux context); else copy + chmod. */
  private fun ensureCliEntry(src: File, dest: File): Boolean {
    if (dest.exists() && !dest.delete()) {
      Log.w(TAG, "could not replace ${dest.name}")
    }
    try {
      Os.symlink(src.absolutePath, dest.absolutePath)
      Log.d(TAG, "symlink ${dest.name} -> ${src.absolutePath}")
      return true
    } catch (e: Exception) {
      Log.d(TAG, "symlink ${dest.name} unavailable, copying: ${e.message}")
    }
    return copyAsExecutable(src, dest)
  }

  /** Copy ELF to codeCacheDir and mark read+exec only (W^X). */
  private fun copyAsExecutable(src: File, dest: File): Boolean {
    return try {
      if (!dest.isFile || dest.length() != src.length()) {
        src.inputStream().use { input ->
          dest.outputStream().use { output -> input.copyTo(output) }
        }
      }
      applyExecMode(dest)
      true
    } catch (e: Exception) {
      Log.w(TAG, "copy ${dest.name} failed", e)
      false
    }
  }

  /** Remove write permission — required to exec from app private storage on Android 10+. */
  private fun applyExecMode(file: File) {
    file.setReadable(true, false)
    file.setWritable(false, false)
    file.setExecutable(true, false)
    try {
      Os.chmod(file.absolutePath, EXEC_MODE)
    } catch (e: Exception) {
      Log.w(TAG, "chmod ${file.name}: ${e.message}")
    }
  }

  /** Start ffmpeg; fall back to linker64 when direct exec hits EACCES on some OEM ROMs. */
  private fun startFfmpegProcess(
    ffmpeg: File,
    ldPath: String,
    args: List<String>,
  ): Process {
    val env = mapOf("LD_LIBRARY_PATH" to ldPath)
    try {
      return ProcessBuilder(listOf(ffmpeg.absolutePath) + args)
        .redirectErrorStream(true)
        .apply { environment().putAll(env) }
        .start()
    } catch (e: IOException) {
      if (!isPermissionDenied(e)) throw e
      Log.w(TAG, "direct ffmpeg exec denied, trying linker64")
      return ProcessBuilder(listOf("/system/bin/linker64", ffmpeg.absolutePath) + args)
        .redirectErrorStream(true)
        .apply { environment().putAll(env) }
        .start()
    }
  }

  private fun isPermissionDenied(e: IOException): Boolean {
    val msg = e.message.orEmpty()
    return msg.contains("error=13", ignoreCase = true) ||
      msg.contains("Permission denied", ignoreCase = true) ||
      msg.contains("EACCES", ignoreCase = true)
  }

  /** Older builds wrote here; cache is often noexec — remove stale binaries. */
  private fun removeLegacyCacheBin(context: Context) {
    val legacy = File(context.cacheDir, BIN_DIR_NAME)
    if (legacy.isDirectory) {
      legacy.listFiles()?.forEach { it.delete() }
      legacy.delete()
    }
  }

  private fun readLdLibraryPath(context: Context): String? {
    return try {
      YoutubeDL.getInstance().init(context)
      val clazz = Class.forName("com.yausername.youtubedl_android.YoutubeDL")
      val instance = clazz.getDeclaredField("INSTANCE").get(null)
      val field = clazz.getDeclaredField("ENV_LD_LIBRARY_PATH")
      field.isAccessible = true
      field.get(instance) as? String
    } catch (e: Exception) {
      Log.w(TAG, "readLdLibraryPath failed", e)
      null
    }
  }
}
