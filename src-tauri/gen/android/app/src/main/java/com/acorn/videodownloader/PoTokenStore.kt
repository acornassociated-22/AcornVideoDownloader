package com.acorn.videodownloader

import android.content.Context
import android.webkit.CookieManager
import android.util.Log
import org.json.JSONObject
import java.io.File

/** Cache YouTube PO token + visitor_data for yt-dlp extractor-args (TTL ~6 h). */
object PoTokenStore {
  private const val TAG = "PoTokenStore"
  private const val STORE_FILE = "po-token-store.json"
  private const val TTL_MS = 6L * 60 * 60 * 1000

  data class TokenPair(
    val poToken: String?,
    val visitorData: String?,
    val fetchedAt: Long,
  ) {
    fun isFresh(): Boolean =
      fetchedAt > 0 && System.currentTimeMillis() - fetchedAt < TTL_MS

    fun isUsable(): Boolean = !poToken.isNullOrBlank() || !visitorData.isNullOrBlank()
  }

  /** Read cached token pair if still fresh. */
  fun get(context: Context): TokenPair? {
    val file = storeFile(context)
    if (!file.isFile) return null
    return try {
      val root = JSONObject(file.readText())
      val pair =
        TokenPair(
          poToken = root.optString("poToken", null),
          visitorData = root.optString("visitorData", null),
          fetchedAt = root.optLong("fetchedAt", 0L),
        )
      if (pair.isFresh() && pair.isUsable()) pair else null
    } catch (e: Exception) {
      Log.w(TAG, "read failed", e)
      null
    }
  }

  /** Harvest VISITOR_INFO1_LIVE and related cookies after WebView session. */
  fun harvestFromCookies(context: Context) {
    try {
      val cookies = CookieManager.getInstance().getCookie("https://www.youtube.com") ?: return
      var visitorData: String? = null
      cookies.split(';').forEach { part ->
        val trimmed = part.trim()
        if (trimmed.startsWith("VISITOR_INFO1_LIVE=")) {
          visitorData = trimmed.substringAfter('=')
        }
      }
      if (visitorData.isNullOrBlank()) return
      persist(
        context,
        TokenPair(
          poToken = null,
          visitorData = visitorData,
          fetchedAt = System.currentTimeMillis(),
        ),
      )
      Log.d(TAG, "harvested visitor_data")
    } catch (e: Exception) {
      Log.w(TAG, "harvest failed", e)
    }
  }

  /** Build --extractor-args value when tokens are available. */
  fun extractorArgs(context: Context): String? {
    val pair = get(context) ?: return null
    val parts = mutableListOf<String>()
    if (!pair.poToken.isNullOrBlank()) parts.add("po_token=${pair.poToken}")
    if (!pair.visitorData.isNullOrBlank()) parts.add("visitor_data=${pair.visitorData}")
    if (parts.isEmpty()) return null
    return "youtube:${parts.joinToString(";")}"
  }

  /** Extract po_token / visitor_data overlay from an existing extractor-args string. */
  fun poTokenOverlay(extractorArgs: String): String? {
    val fields = parseYoutubeExtractorFields(extractorArgs)
    val parts = mutableListOf<String>()
    fields["po_token"]?.let { parts.add("po_token=$it") }
    fields["visitor_data"]?.let { parts.add("visitor_data=$it") }
    if (parts.isEmpty()) return null
    return "youtube:${parts.joinToString(";")}"
  }

  /** Merge PO token fields from overlay into base youtube: extractor-args. */
  fun mergeExtractorArgStrings(base: String, overlay: String): String {
    val merged = parseYoutubeExtractorFields(base)
    parseYoutubeExtractorFields(overlay).forEach { (key, value) ->
      if (key == "po_token" || key == "visitor_data") {
        merged[key] = value
      }
    }
    val result = formatYoutubeExtractorFields(merged)
    Log.d(TAG, "mergeExtractorArgs base=${base.take(80)} overlay=${overlay.take(80)} -> ${result.take(120)}")
    return result
  }

  private fun parseYoutubeExtractorFields(value: String): MutableMap<String, String> {
    val body = value.removePrefix("youtube:")
    val map = linkedMapOf<String, String>()
    body.split(';').forEach { part ->
      val trimmed = part.trim()
      if (trimmed.isEmpty()) return@forEach
      val idx = trimmed.indexOf('=')
      if (idx <= 0) return@forEach
      map[trimmed.substring(0, idx)] = trimmed.substring(idx + 1)
    }
    return map
  }

  private fun formatYoutubeExtractorFields(fields: Map<String, String>): String {
    return "youtube:" + fields.entries.joinToString(";") { "${it.key}=${it.value}" }
  }

  private fun persist(context: Context, pair: TokenPair) {
    try {
      val root =
        JSONObject()
          .put("poToken", pair.poToken)
          .put("visitorData", pair.visitorData)
          .put("fetchedAt", pair.fetchedAt)
      storeFile(context).writeText(root.toString())
    } catch (e: Exception) {
      Log.w(TAG, "persist failed", e)
    }
  }

  private fun storeFile(context: Context): File = File(context.filesDir, STORE_FILE)
}
