package com.acorn.videodownloader

import android.content.Context
import android.util.Log
import com.yausername.youtubedl_android.YoutubeDL
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Update bundled yt-dlp Python script from GitHub releases (Python 3.8 compatible only). */
object YtdlpUpdater {
  private const val TAG = "YtdlpUpdater"
  private const val RELEASES_API =
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases?per_page=15"
  private const val BACKUP_NAME = "yt-dlp.bundled.bak"
  private const val PREFS_NAME = "YoutubeDL"
  private const val PREFS_VERSION_KEY = "dlpVersionKey"
  private const val PREFS_VERSION_NAME_KEY = "dlpVersionNameKey"
  private const val PREFS_CACHE_AT = "ytdlpUpdateCheckAt"
  private const val PREFS_CACHE_CURRENT = "ytdlpCachedCurrent"
  private const val PREFS_CACHE_LATEST = "ytdlpCachedLatest"
  private const val PREFS_CACHE_AVAILABLE = "ytdlpCachedAvailable"
  private const val PREFS_CACHE_DOWNLOAD_URL = "ytdlpCachedDownloadUrl"
  private const val PREFS_CACHE_SHA256 = "ytdlpCachedSha256"
  private const val PREFS_AUTO_UPDATE = "androidYtdlpAutoUpdate"
  private const val CACHE_TTL_MS = 24L * 60L * 60L * 1000L
  private const val MAX_RELEASE_PROBE = 12

  data class UpdateInfo(
    val currentVersion: String,
    val latestVersion: String,
    val updateAvailable: Boolean,
    val downloadUrl: String?,
    val sha256: String?,
  )

  data class ApplyResult(
    val success: Boolean,
    val version: String,
    val error: String?,
  )

  private data class ReleaseCandidate(
    val tag: String,
    val downloadUrl: String,
    val sha256: String?,
  )

  /** Read current yt-dlp script version via verified subprocess. */
  fun currentVersion(context: Context): String {
    return readVersion(context) ?: "unknown"
  }

  /** Restore bundled backup when the active script fails --version. */
  fun restoreIfBroken(context: Context): Boolean {
    if (AcornYtdlpExecutor.verifyYtdlpScript(context)) return false
    Log.w(TAG, "restoreIfBroken — script verify failed, attempting rollback")
    val ytdlpPath = resolveYtdlpScript(context) ?: return false
    val backup = File(ytdlpPath.parentFile, BACKUP_NAME)
    if (!backup.isFile) {
      Log.e(TAG, "restoreIfBroken — no backup at ${backup.absolutePath}")
      return false
    }
    return try {
      backup.copyTo(ytdlpPath, overwrite = true)
      ytdlpPath.setExecutable(true)
      YoutubeDL.getInstance().init(context)
      val version = readVersion(context)
      if (version != null) {
        writeVersionPrefs(context, version)
        Log.i(TAG, "restoreIfBroken success version=$version")
        true
      } else {
        false
      }
    } catch (e: Exception) {
      Log.e(TAG, "restoreIfBroken failed", e)
      false
    }
  }

  /** Resolve version: verified subprocess first, SharedPrefs fallback. */
  private fun readVersion(context: Context): String? {
    val subprocess = AcornYtdlpExecutor.runVersionCheck(context)
    if (!subprocess.isNullOrBlank()) {
      Log.d(TAG, "readVersion subprocess=$subprocess")
      return normalizeVersion(subprocess)
    }
    try {
      YoutubeDL.getInstance().init(context)
      val apiVersion = YoutubeDL.getInstance().version(context)?.trim()
      if (!apiVersion.isNullOrBlank() && apiVersion != "unknown") {
        Log.d(TAG, "readVersion api=$apiVersion")
        return normalizeVersion(apiVersion)
      }
    } catch (e: Exception) {
      Log.w(TAG, "readVersion api failed", e)
    }
    Log.w(TAG, "readVersion all methods failed")
    return null
  }

  /** Query GitHub for the newest release compatible with embedded Python 3.8. */
  fun checkForUpdate(context: Context, forceRefresh: Boolean = false): UpdateInfo {
    Log.i(TAG, "checkForUpdate start force=$forceRefresh")
    restoreIfBroken(context)
    val current = currentVersion(context)
    if (!AcornYtdlpExecutor.verifyYtdlpScript(context)) {
      Log.e(TAG, "checkForUpdate — script still broken after restore")
      return UpdateInfo(current, current, false, null, null)
    }
    if (!forceRefresh) {
      readCachedUpdate(context, current)?.let { cached ->
        Log.i(TAG, "checkForUpdate cache hit latest=${cached.latestVersion}")
        return cached
      }
    }
    val releases = fetchRecentReleases()
    if (releases.isEmpty()) {
      Log.w(TAG, "checkForUpdate — no releases fetched")
      return UpdateInfo(current, current, false, null, null).also { writeUpdateCache(context, it) }
    }
    val compatible =
      findNewestCompatibleRelease(context, releases, current)
        ?: run {
          Log.w(TAG, "checkForUpdate — no Python-3.8-compatible release found")
          return UpdateInfo(current, current, false, null, null).also { writeUpdateCache(context, it) }
        }
    val latest = compatible.tag
    val updateAvailable =
      latest.isNotBlank() &&
        normalizeVersion(latest) != normalizeVersion(current) &&
        compatible.downloadUrl.isNotBlank()
    Log.i(
      TAG,
      "checkForUpdate done current=$current latest=$latest updateAvailable=$updateAvailable",
    )
    return UpdateInfo(
      currentVersion = current,
      latestVersion = latest,
      updateAvailable = updateAvailable,
      downloadUrl = compatible.downloadUrl,
      sha256 = compatible.sha256,
    ).also { writeUpdateCache(context, it) }
  }

  /** Download compatible script, verify, replace; rollback on any verify failure. */
  fun applyUpdate(context: Context): ApplyResult {
    Log.i(TAG, "applyUpdate start")
    val info = checkForUpdate(context, forceRefresh = true)
    if (!info.updateAvailable) {
      val msg = "No compatible update (current=${info.currentVersion})"
      Log.w(TAG, "applyUpdate abort: $msg")
      return ApplyResult(false, info.currentVersion, msg)
    }
    val ytdlpPath = resolveYtdlpScript(context)
    if (ytdlpPath == null) {
      val msg = "Could not resolve yt-dlp script path"
      Log.e(TAG, "applyUpdate abort: $msg")
      return ApplyResult(false, info.currentVersion, msg)
    }
    val backup = File(ytdlpPath.parentFile, BACKUP_NAME)
    val tmp = File(ytdlpPath.parentFile, "yt-dlp.download")
    val releases = fetchRecentReleases()
    val candidates =
      releases.filter { normalizeVersion(it.tag) == normalizeVersion(info.latestVersion) } +
        releases.filter { normalizeVersion(it.tag) != normalizeVersion(info.latestVersion) }
    try {
      if (ytdlpPath.isFile) {
        ytdlpPath.copyTo(backup, overwrite = true)
        Log.d(TAG, "applyUpdate backup=${backup.absolutePath}")
      }
      for (candidate in candidates.take(MAX_RELEASE_PROBE)) {
        Log.i(TAG, "applyUpdate trying release=${candidate.tag}")
        downloadFile(candidate.downloadUrl, tmp)
        if (!candidate.sha256.isNullOrBlank()) {
          val actual = sha256Hex(tmp)
          if (!actual.equals(candidate.sha256, ignoreCase = true)) {
            Log.w(TAG, "applyUpdate SHA256 mismatch for ${candidate.tag} — skip")
            tmp.delete()
            continue
          }
        }
        val verified = AcornYtdlpExecutor.runVersionCheck(context, tmp)
        if (verified.isNullOrBlank()) {
          Log.w(TAG, "applyUpdate verify failed for ${candidate.tag}")
          tmp.delete()
          continue
        }
        tmp.copyTo(ytdlpPath, overwrite = true)
        tmp.delete()
        ytdlpPath.setExecutable(true)
        YoutubeDL.getInstance().init(context)
        val liveVersion = readVersion(context)
        if (liveVersion.isNullOrBlank()) {
          Log.e(TAG, "applyUpdate post-replace verify failed — rolling back")
          rollbackFromBackup(backup, ytdlpPath)
          return ApplyResult(false, info.currentVersion, "Update failed verification")
        }
        writeVersionPrefs(context, liveVersion)
        clearUpdateCache(context)
        Log.i(TAG, "applyUpdate success version=$liveVersion")
        return ApplyResult(true, liveVersion, null)
      }
      rollbackFromBackup(backup, ytdlpPath)
      return ApplyResult(
        false,
        info.currentVersion,
        "No compatible yt-dlp release found for embedded Python",
      )
    } catch (e: Exception) {
      Log.e(TAG, "applyUpdate failed", e)
      rollbackFromBackup(backup, ytdlpPath)
      tmp.delete()
      return ApplyResult(false, info.currentVersion, e.message ?: "Update failed")
    }
  }

  fun isAutoUpdateEnabled(context: Context): Boolean =
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(PREFS_AUTO_UPDATE, true)

  fun setAutoUpdateEnabled(context: Context, enabled: Boolean) {
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(PREFS_AUTO_UPDATE, enabled)
      .apply()
  }

  /**
   * Silently update yt-dlp when idle and a compatible release exists.
   * Returns null when skipped (disabled, busy, or already current).
   */
  fun tryAutoUpdate(context: Context): ApplyResult? {
    if (!isAutoUpdateEnabled(context)) {
      Log.d(TAG, "tryAutoUpdate skipped — auto update disabled")
      return null
    }
    if (orchestratorHasActiveWork(context)) {
      Log.d(TAG, "tryAutoUpdate skipped — queue has active work")
      return null
    }
    val info = checkForUpdate(context, forceRefresh = false)
    if (!info.updateAvailable) {
      Log.d(TAG, "tryAutoUpdate skipped — up to date (${info.currentVersion})")
      return null
    }
    Log.i(
      TAG,
      "tryAutoUpdate applying ${info.currentVersion} -> ${info.latestVersion}",
    )
    return applyUpdate(context)
  }

  private fun orchestratorHasActiveWork(context: Context): Boolean {
    val file = File(context.filesDir, "download-orchestrator.json")
    if (!file.isFile) return false
    return try {
      val root = JSONObject(file.readText())
      val activeId = root.optString("activeId", null)
      if (!activeId.isNullOrBlank()) return true
      val items = root.optJSONArray("items") ?: return false
      for (i in 0 until items.length()) {
        when (items.getJSONObject(i).optString("status", "")) {
          "queued", "downloading", "paused" -> return true
        }
      }
      false
    } catch (e: Exception) {
      Log.w(TAG, "orchestratorHasActiveWork parse failed", e)
      false
    }
  }

  private fun rollbackFromBackup(backup: File, ytdlpPath: File) {
    if (!backup.isFile) return
    try {
      backup.copyTo(ytdlpPath, overwrite = true)
      ytdlpPath.setExecutable(true)
      Log.w(TAG, "applyUpdate rolled back from backup")
    } catch (e: Exception) {
      Log.e(TAG, "applyUpdate rollback failed", e)
    }
  }

  /** Pick newest release whose yt-dlp asset passes --version under embedded Python. */
  private fun findNewestCompatibleRelease(
    context: Context,
    releases: List<ReleaseCandidate>,
    currentVersion: String,
  ): ReleaseCandidate? {
    val currentNorm = normalizeVersion(currentVersion)
    val apiNewest = releases.firstOrNull()?.tag?.let { normalizeVersion(it) }
    if (!apiNewest.isNullOrBlank() && apiNewest == currentNorm) {
      Log.i(TAG, "findNewestCompatibleRelease skip probe — current matches API newest")
      return releases.first()
    }
    val probeDir = File(context.cacheDir, "ytdlp-probe").also { it.mkdirs() }
    for (candidate in releases.take(MAX_RELEASE_PROBE)) {
      val tmp = File(probeDir, "yt-dlp-probe-${candidate.tag}")
      try {
        downloadFile(candidate.downloadUrl, tmp)
        val version = AcornYtdlpExecutor.runVersionCheck(context, tmp)
        if (!version.isNullOrBlank()) {
          Log.i(TAG, "findNewestCompatibleRelease tag=${candidate.tag} version=$version")
          return candidate
        }
      } catch (e: Exception) {
        Log.w(TAG, "findNewestCompatibleRelease failed tag=${candidate.tag}", e)
      } finally {
        tmp.delete()
      }
    }
    return null
  }

  /** Return cached update info when fresh and current version still matches. */
  private fun readCachedUpdate(context: Context, current: String): UpdateInfo? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val cachedAt = prefs.getLong(PREFS_CACHE_AT, 0L)
    if (cachedAt <= 0L || System.currentTimeMillis() - cachedAt > CACHE_TTL_MS) return null
    val cachedCurrent = prefs.getString(PREFS_CACHE_CURRENT, null) ?: return null
    if (normalizeVersion(cachedCurrent) != normalizeVersion(current)) return null
    return UpdateInfo(
      currentVersion = cachedCurrent,
      latestVersion = prefs.getString(PREFS_CACHE_LATEST, cachedCurrent) ?: cachedCurrent,
      updateAvailable = prefs.getBoolean(PREFS_CACHE_AVAILABLE, false),
      downloadUrl = prefs.getString(PREFS_CACHE_DOWNLOAD_URL, null),
      sha256 = prefs.getString(PREFS_CACHE_SHA256, null),
    )
  }

  private fun writeUpdateCache(context: Context, info: UpdateInfo) {
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putLong(PREFS_CACHE_AT, System.currentTimeMillis())
      .putString(PREFS_CACHE_CURRENT, info.currentVersion)
      .putString(PREFS_CACHE_LATEST, info.latestVersion)
      .putBoolean(PREFS_CACHE_AVAILABLE, info.updateAvailable)
      .putString(PREFS_CACHE_DOWNLOAD_URL, info.downloadUrl)
      .putString(PREFS_CACHE_SHA256, info.sha256)
      .apply()
  }

  private fun clearUpdateCache(context: Context) {
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(PREFS_CACHE_AT)
      .remove(PREFS_CACHE_CURRENT)
      .remove(PREFS_CACHE_LATEST)
      .remove(PREFS_CACHE_AVAILABLE)
      .remove(PREFS_CACHE_DOWNLOAD_URL)
      .remove(PREFS_CACHE_SHA256)
      .apply()
  }

  private fun fetchRecentReleases(): List<ReleaseCandidate> {
    val conn = URL(RELEASES_API).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 15_000
    conn.setRequestProperty("Accept", "application/vnd.github+json")
    conn.setRequestProperty("User-Agent", "AcornVideoDownloader")
    return try {
      if (conn.responseCode !in 200..299) {
        Log.e(TAG, "fetchRecentReleases http=${conn.responseCode}")
        emptyList()
      } else {
        val body = conn.inputStream.bufferedReader().readText()
        val arr = JSONArray(body)
        val out = mutableListOf<ReleaseCandidate>()
        for (i in 0 until arr.length()) {
          val root = arr.getJSONObject(i)
          val tag = root.optString("tag_name", "").removePrefix("v")
          if (tag.isBlank()) continue
          var downloadUrl: String? = null
          var sha256: String? = null
          val assets = root.optJSONArray("assets") ?: continue
          for (j in 0 until assets.length()) {
            val asset = assets.getJSONObject(j)
            val name = asset.optString("name", "")
            if (name == "SHA2-256SUMS") {
              val sumsUrl = asset.optString("browser_download_url", "")
              if (sumsUrl.isNotBlank()) sha256 = fetchSha256ForYtdlp(sumsUrl)
            }
            if (name == "yt-dlp" && downloadUrl == null) {
              downloadUrl = asset.optString("browser_download_url", null)
            }
          }
          if (!downloadUrl.isNullOrBlank()) {
            out.add(ReleaseCandidate(tag, downloadUrl, sha256))
          }
        }
        out
      }
    } catch (e: Exception) {
      Log.e(TAG, "fetchRecentReleases failed", e)
      emptyList()
    } finally {
      conn.disconnect()
    }
  }

  private fun resolveYtdlpScript(context: Context): File? {
    return try {
      YoutubeDL.getInstance().init(context)
      val clazz = Class.forName("com.yausername.youtubedl_android.YoutubeDL")
      val instance = clazz.getDeclaredField("INSTANCE").get(null)
      val f = clazz.getDeclaredField("ytdlpPath")
      f.isAccessible = true
      f.get(instance) as? File
    } catch (e: Exception) {
      Log.w(TAG, "resolveYtdlpScript failed", e)
      null
    }
  }

  private fun writeVersionPrefs(context: Context, version: String) {
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PREFS_VERSION_KEY, version)
      .putString(PREFS_VERSION_NAME_KEY, version)
      .apply()
  }

  private fun normalizeVersion(raw: String): String =
    raw.removePrefix("v").trim().substringBefore(" ").trim()

  private fun downloadFile(url: String, dest: File) {
    Log.d(TAG, "downloadFile start url=$url dest=${dest.absolutePath}")
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 30_000
    conn.readTimeout = 120_000
    conn.setRequestProperty("User-Agent", "AcornVideoDownloader")
    try {
      if (conn.responseCode !in 200..299) {
        throw IllegalStateException("Download HTTP ${conn.responseCode}")
      }
      conn.inputStream.use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      }
      dest.setExecutable(true)
    } finally {
      conn.disconnect()
    }
  }

  private fun fetchSha256ForYtdlp(sumsUrl: String): String? {
    val conn = URL(sumsUrl).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 15_000
    return try {
      val text = conn.inputStream.bufferedReader().readText()
      text
        .lineSequence()
        .map { it.trim() }
        .firstOrNull { line -> Regex("""^[0-9a-fA-F]{64}\s+yt-dlp$""").matches(line) }
        ?.substringBefore(" ")
        ?.trim()
    } finally {
      conn.disconnect()
    }
  }

  private fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buf = ByteArray(8192)
      var read: Int
      while (input.read(buf).also { read = it } > 0) {
        digest.update(buf, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
