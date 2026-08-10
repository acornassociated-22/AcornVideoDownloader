package com.acorn.videodownloader

import android.content.Context
import android.util.Log
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/** Native playlist queue with backoff, pacing, and foreground service integration. */
object DownloadOrchestrator {
  private const val TAG = "DownloadOrchestrator"
  private const val STATE_FILE = "download-orchestrator.json"
  private const val MAX_BOT_RETRIES = 3
  private val BOT_BACKOFF_MS = longArrayOf(30_000L, 90_000L, 180_000L)
  private const val GUEST_INTER_MIN_MS = 15_000L
  private const val GUEST_INTER_MAX_MS = 30_000L
  private val GUEST_BOT_BACKOFF_MS = longArrayOf(60_000L, 120_000L, 180_000L)
  private const val GUEST_FAIL_PAUSE_MS = 45_000L
  private const val GUEST_SAFE_BULK_INTERVAL = 5
  private const val GUEST_SAFE_BULK_PAUSE_MS = 90_000L
  private const val JITTER_MIN_MS = 2_000L
  private const val JITTER_MAX_MS = 5_000L
  private const val SAFE_BULK_PAUSE_MS = 60_000L
  private const val PROGRESS_EMIT_MS = 500L

  private val running = AtomicBoolean(false)
  private val paused = AtomicBoolean(false)
  private val loopExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  @Volatile
  private var state: OrchestratorState = OrchestratorState()

  @Volatile
  private var eventSink: ((String, JSObject) -> Unit)? = null

  @Volatile
  private var lastProgressEmitMs = 0L

  fun setEventSink(sink: ((String, JSObject) -> Unit)?) {
    eventSink = sink
    if (sink != null && state.items.isNotEmpty()) {
      Log.d(TAG, "eventSink attached — re-emitting queue-state (${state.items.size} items)")
      emitQueueState()
    }
  }

  /** Apply queue snapshot from the React store and kick the loop. */
  fun syncFromJson(context: Context, json: String) {
    try {
      val incoming = OrchestratorState.fromJson(json)
      Log.i(TAG, "syncFromJson incoming=${incoming.items.size} items active=${incoming.activeId}")
      if (incoming.settings.has("androidYtdlpAutoUpdate")) {
        YtdlpUpdater.setAutoUpdateEnabled(
          context,
          incoming.settings.optBoolean("androidYtdlpAutoUpdate", true),
        )
      }
      state = mergeIncomingState(state, incoming)
      persist(context)
      emitQueueState()
      if (state.hasWork()) {
        DownloadForegroundService.ensureRunning(context)
        ensureLoop(context)
      }
    } catch (e: Exception) {
      Log.e(TAG, "syncFromJson failed", e)
    }
  }

  /** Keep in-flight native progress when React still shows stale queued status. */
  private fun mergeIncomingState(
    current: OrchestratorState,
    incoming: OrchestratorState,
  ): OrchestratorState {
    if (current.items.isEmpty()) return incoming
    val currentById = current.items.associateBy { it.id }
    val statusRank =
      mapOf(
        "cancelled" to 1,
        "queued" to 2,
        "paused" to 2,
        "error" to 3,
        "downloading" to 4,
        "completed" to 5,
      )
    fun rank(status: String): Int = statusRank[status] ?: 0

    val mergedItems =
      incoming.items.map { inc ->
        val cur = currentById[inc.id] ?: return@map inc
        if (inc.status == "cancelled") {
          return@map inc.copy(
            title = inc.title.ifBlank { cur.title },
            url = inc.url.ifBlank { cur.url },
            options = if (inc.options.isNotEmpty()) inc.options else cur.options,
          )
        }
        val keepCurrent =
          rank(cur.status) > rank(inc.status) ||
            (cur.status == "downloading" && inc.status == "queued") ||
            (cur.status == "completed" && inc.status != "completed") ||
            (cur.retryCount > inc.retryCount && cur.status == "queued")
        if (keepCurrent) {
          cur.copy(
            title = inc.title,
            url = inc.url,
            options = if (inc.options.isNotEmpty()) inc.options else cur.options,
          )
        } else {
          inc
        }
      }
    return incoming.copy(
      items = mergedItems,
      activeId =
        if (mergedItems.isEmpty()) {
          null
        } else {
          current.activeId?.takeIf { id -> mergedItems.any { it.id == id } }
            ?: incoming.activeId
        },
      globalBotStreak = maxOf(current.globalBotStreak, incoming.globalBotStreak),
      successCount = maxOf(current.successCount, incoming.successCount),
      pausedUntil = maxOf(current.pausedUntil, incoming.pausedUntil),
    )
  }

  /** Load persisted state on cold start. */
  fun restore(context: Context) {
    val file = stateFile(context)
    if (!file.isFile) return
    try {
      state = OrchestratorState.fromJson(file.readText())
      emitQueueState()
    } catch (e: Exception) {
      Log.w(TAG, "restore failed", e)
    }
  }

  fun pause(context: Context) {
    paused.set(true)
    updateNotification(context.applicationContext)
    emitQueueState()
  }

  fun resume(context: Context) {
    paused.set(false)
    ensureLoop(context)
    emitQueueState()
  }

  fun cancelActive() {
    val active = state.activeId ?: return
    val plugin = DownloadServiceHolder.ytdlp() ?: return
    try {
      plugin.cancelProcess(active)
    } catch (e: Exception) {
      Log.w(TAG, "cancelActive failed", e)
    }
  }

  /** Cancel one queue item (active or waiting) and mark it cancelled. */
  fun cancelJob(context: Context, id: String) {
    if (state.activeId == id) {
      cancelActive()
    }
    val item = state.items.find { it.id == id } ?: return
    replaceItemById(
      id,
      item.copy(status = "cancelled", error = "Cancelled", percent = 0.0),
    )
    if (state.activeId == id) {
      state = state.copy(activeId = null)
    }
    persist(context)
    emitQueueState()
    updateNotification(context.applicationContext)
    Log.i(TAG, "cancelJob id=$id")
  }

  /** Stop the active yt-dlp job and mark that item paused (user resume later). */
  fun pauseActiveJob(context: Context) {
    val activeId = state.activeId ?: return
    val item = state.items.find { it.id == activeId } ?: return
    replaceItemById(activeId, item.copy(status = "paused", error = null))
    state = state.copy(activeId = null)
    cancelActive()
    persist(context)
    emitQueueState()
    updateNotification(context.applicationContext)
    Log.i(TAG, "pauseActiveJob id=$activeId")
  }

  /** Re-queue a paused item and restart the download loop. */
  fun resumeJob(context: Context, id: String) {
    val item = state.items.find { it.id == id } ?: return
    if (item.status != "paused") return
    replaceItemById(id, item.copy(status = "queued", error = null))
    persist(context)
    emitQueueState()
    DownloadForegroundService.ensureRunning(context)
    ensureLoop(context)
    Log.i(TAG, "resumeJob id=$id")
  }

  /** Cancel active work if needed, reset progress, and re-queue one item. */
  fun retryJob(context: Context, id: String) {
    if (state.activeId == id) {
      cancelActive()
    }
    val item = state.items.find { it.id == id } ?: return
    replaceItemById(
      id,
      item.copy(status = "queued", percent = 0.0, error = null),
    )
    if (state.activeId == id) {
      state = state.copy(activeId = null)
    }
    persist(context)
    emitQueueState()
    DownloadForegroundService.ensureRunning(context)
    ensureLoop(context)
    Log.i(TAG, "retryJob id=$id")
  }

  /** Resume the first paused item (notification action). */
  fun resumePausedJob(context: Context) {
    val paused = state.items.firstOrNull { it.status == "paused" } ?: return
    resumeJob(context, paused.id)
  }

  fun requeueFailedBotItems(context: Context) {
    val updated =
      state.items.map { item ->
        if (
          item.status == "error" &&
            item.isYoutube &&
            item.isBotError &&
            item.retryCount < MAX_BOT_RETRIES
        ) {
          item.copy(status = "queued", error = null, percent = 0.0)
        } else {
          item
        }
      }
    if (updated == state.items) return
    state = state.copy(items = updated)
    persist(context)
    emitQueueState()
    ensureLoop(context)
  }

  fun ensureLoop(context: Context) {
    if (!running.compareAndSet(false, true)) return
    loopExecutor.execute { runLoop(context.applicationContext) }
  }

  fun stop(context: Context) {
    running.set(false)
    paused.set(false)
    DownloadWakeLock.release()
  }

  /** Replace one queue item by index (immutable List). */
  private fun replaceItemAt(index: Int, item: OrchestratorItem) {
    state =
      state.copy(
        items = state.items.mapIndexed { i, existing -> if (i == index) item else existing },
      )
  }

  /** Replace one queue item by id. */
  private fun replaceItemById(id: String, item: OrchestratorItem) {
    state =
      state.copy(
        items = state.items.map { existing -> if (existing.id == id) item else existing },
      )
  }

  /** Update live download percent from yt-dlp progress (throttled queue-state emit). */
  fun updateItemProgress(id: String, percent: Double) {
    val item = state.items.find { it.id == id } ?: return
    if (item.status != "downloading" && state.activeId != id) return
    val pct = percent.coerceIn(0.0, 100.0)
    if (item.percent >= pct && pct < 100.0) return
    replaceItemById(id, item.copy(percent = pct))
    val now = System.currentTimeMillis()
    if (now - lastProgressEmitMs < PROGRESS_EMIT_MS) return
    lastProgressEmitMs = now
    emitQueueState()
    DownloadServiceHolder.activity()?.applicationContext?.let { updateNotification(it) }
  }

  private fun runLoop(appContext: Context) {
    try {
      while (true) {
        if (!running.get()) break
        if (paused.get()) {
          Thread.sleep(500L)
          continue
        }
        val now = System.currentTimeMillis()
        if (state.pausedUntil > now) {
          updateNotification(appContext)
          Thread.sleep(minOf(1_000L, state.pausedUntil - now))
          continue
        }
        var nextIndex = state.items.indexOfFirst { it.status == "queued" }
        if (nextIndex < 0) {
          nextIndex = recoverFailedBotIndex()
        }
        if (nextIndex < 0) {
          if (!state.hasWork()) {
            DownloadForegroundService.requestStop(appContext)
            Thread(
              {
                try {
                  YtdlpUpdater.tryAutoUpdate(appContext)
                } catch (e: Exception) {
                  Log.w(TAG, "yt-dlp auto-update after queue idle failed", e)
                }
              },
              "YtdlpAutoUpdateIdle",
            ).start()
          }
          break
        }
        val item = state.items[nextIndex]
        applyPreDownloadPacing(appContext, item)
        state = state.copy(activeId = item.id)
        replaceItemAt(nextIndex, item.copy(status = "downloading", percent = 0.0, error = null))
        persist(appContext)
        Log.i(TAG, "runLoop downloading id=${item.id} title=${item.title.take(40)}")
        emitQueueState()
        updateNotification(appContext)

        val activity = DownloadServiceHolder.activity()
        val plugin = DownloadServiceHolder.ytdlp()
        if (activity == null || plugin == null) {
          Log.w(TAG, "activity/plugin unavailable — waiting")
          replaceItemAt(nextIndex, item.copy(status = "queued"))
          state = state.copy(activeId = null)
          persist(appContext)
          Thread.sleep(2_000L)
          continue
        }

        DownloadWakeLock.acquire(appContext)
        val result =
          try {
            plugin.runDownloadBlocking(
              activity,
              item.url,
              item.options,
              item.id,
            )
          } finally {
            DownloadWakeLock.release()
          }

        val current = state.items.find { it.id == item.id } ?: continue

        when {
          result.cancelled -> {
            val afterCancel = state.items.find { it.id == item.id } ?: continue
            if (afterCancel.status != "paused") {
              replaceItemById(item.id, afterCancel.copy(status = "cancelled", error = "Cancelled"))
            }
          }
          result.success -> {
            val updated =
              current.copy(
                status = "completed",
                percent = 100.0,
                filename = result.filename,
                error = null,
              )
            state =
              state.copy(
                globalBotStreak = 0,
                successCount = state.successCount + 1,
              )
            replaceItemById(item.id, updated)
            applyPostSuccessPacing(appContext)
            Log.i(TAG, "runLoop completed id=${item.id} file=${result.filename?.take(60)}")
            DownloadNotificationManager.showCompleted(
              appContext,
              "Download complete",
              updated.title,
            )
          }
          result.botError && current.retryCount < MAX_BOT_RETRIES -> {
            val attempt = current.retryCount + 1
            val newStreak = state.globalBotStreak + 1
            val waitMs = botBackoffMs(newStreak, appContext)
            val pausedUntil = System.currentTimeMillis() + waitMs
            CookieBootstrap.forceRefresh(activity, force = true)
            replaceItemById(
              item.id,
              current.copy(
                status = "queued",
                retryCount = attempt,
                lastBotErrorAt = System.currentTimeMillis(),
                cooldownUntil = pausedUntil,
                error = null,
                percent = 0.0,
              ),
            )
            state =
              state.copy(
                activeId = null,
                globalBotStreak = newStreak,
                pausedUntil = pausedUntil,
              )
            persist(appContext)
            emitQueueState()
            updateNotification(appContext)
            continue
          }
          else -> {
            val failed =
              current.copy(
                status = "error",
                error = result.error ?: "Download failed",
                lastBotErrorAt =
                  if (result.botError) System.currentTimeMillis() else current.lastBotErrorAt,
              )
            replaceItemById(item.id, failed)
            if (result.botError) {
              DownloadNotificationManager.showError(
                appContext,
                "YouTube blocked download",
                failed.title,
              )
            }
            if (shouldGuestPace(appContext) && current.isYoutube) {
              val pausedUntil = System.currentTimeMillis() + GUEST_FAIL_PAUSE_MS
              state =
                state.copy(
                  pausedUntil = maxOf(state.pausedUntil, pausedUntil),
                )
              Log.d(TAG, "guest-fail-pause ${GUEST_FAIL_PAUSE_MS}ms after id=${item.id}")
            }
          }
        }
        state = state.copy(activeId = null)
        persist(appContext)
        emitQueueState()
        updateNotification(appContext)
      }
    } catch (e: Exception) {
      Log.e(TAG, "runLoop failed", e)
    } finally {
      running.set(false)
    }
  }

  private fun recoverFailedBotIndex(): Int =
    state.items.indexOfFirst { item ->
      item.status == "error" && item.isYoutube && item.isBotError && item.retryCount < MAX_BOT_RETRIES
    }

  private fun applyPreDownloadPacing(context: Context, item: OrchestratorItem) {
    if (shouldGuestPace(context) && item.isYoutube) {
      val waitMs = guestInterMs()
      Log.d(TAG, "guest-pre-pause ${waitMs}ms before id=${item.id}")
      Thread.sleep(waitMs)
    }
    val settings = state.settings
    val rotateEvery = settings.optInt("androidCookieRotateInterval", 15)
    if (state.successCount > 0 && state.successCount % rotateEvery == 0 && !settings.has("cookiesFile")) {
      DownloadServiceHolder.activity()?.let { CookieBootstrap.forceRefresh(it, force = true) }
    }
  }

  private fun applyPostSuccessPacing(context: Context) {
    val settings = state.settings
    if (shouldGuestPace(context)) {
      val waitMs = guestInterMs()
      Log.d(TAG, "guest-post-jitter ${waitMs}ms after success")
      Thread.sleep(waitMs)
      if (state.successCount > 0 && state.successCount % GUEST_SAFE_BULK_INTERVAL == 0) {
        DownloadServiceHolder.activity()?.let { CookieBootstrap.forceRefresh(it, force = true) }
        val pausedUntil = System.currentTimeMillis() + GUEST_SAFE_BULK_PAUSE_MS
        state = state.copy(pausedUntil = pausedUntil)
        Log.d(TAG, "guest-safe-bulk pause ${GUEST_SAFE_BULK_PAUSE_MS}ms after ${state.successCount} successes")
        Thread.sleep(GUEST_SAFE_BULK_PAUSE_MS)
      }
      return
    }
    if (settings.optBoolean("androidDownloadJitter", true)) {
      Thread.sleep(jitterMs())
    }
    val interval = settings.optInt("androidSafeBulkInterval", 10)
    if (settings.optBoolean("androidSafeBulkMode", false) && state.successCount > 0 && state.successCount % interval == 0) {
      DownloadServiceHolder.activity()?.let { CookieBootstrap.forceRefresh(it, force = true) }
      val pausedUntil = System.currentTimeMillis() + SAFE_BULK_PAUSE_MS
      state = state.copy(pausedUntil = pausedUntil)
      Thread.sleep(SAFE_BULK_PAUSE_MS)
    }
  }

  private fun guestInterMs(): Long =
    GUEST_INTER_MIN_MS + Random.nextLong(GUEST_INTER_MAX_MS - GUEST_INTER_MIN_MS + 1)

  private fun guestPaceEnabled(): Boolean = state.settings.optBoolean("androidGuestPaceMode", true)

  private fun isGuestSession(context: Context): Boolean {
    val activity = DownloadServiceHolder.activity() ?: return true
    return !CookieBootstrap.isAuthenticated(CookieBootstrap.cookiesPath(activity))
  }

  private fun shouldGuestPace(context: Context): Boolean =
    guestPaceEnabled() && isGuestSession(context)

  private fun jitterMs(): Long =
    JITTER_MIN_MS + Random.nextLong(JITTER_MAX_MS - JITTER_MIN_MS + 1)

  private fun botBackoffMs(streak: Int, context: Context): Long {
    val table = if (shouldGuestPace(context)) GUEST_BOT_BACKOFF_MS else BOT_BACKOFF_MS
    val idx = (streak - 1).coerceIn(0, table.size - 1)
    return table[idx]
  }

  private fun persist(context: Context) {
    try {
      stateFile(context).writeText(state.toJson().toString())
    } catch (e: Exception) {
      Log.w(TAG, "persist failed", e)
    }
  }

  private fun stateFile(context: Context): File = File(context.filesDir, STATE_FILE)

  private fun emitQueueState() {
    try {
      val sink = eventSink
      if (sink == null) {
        Log.w(TAG, "emitQueueState skipped — eventSink null (${state.items.size} items)")
        return
      }
      val payload = JSObject()
      payload.put("state", state.toJson().toString())
      Log.d(
        TAG,
        "emitQueueState items=${state.items.size} active=${state.activeId} downloading=${state.items.count { it.status == "downloading" }}",
      )
      sink.invoke("queue-state", payload)
    } catch (e: Exception) {
      Log.w(TAG, "emitQueueState failed", e)
    }
  }

  private fun updateNotification(context: Context?) {
    val ctx = context ?: return
    val total = state.items.size
    val done = state.items.count { it.status == "completed" }
    val active = state.items.find { it.id == state.activeId }
    val pausedItem = state.items.firstOrNull { it.status == "paused" }
    val display = active ?: pausedItem
    val title = display?.title ?: "Acorn downloads"
    val body = "$done/$total completed"
    val pct = display?.percent?.toInt() ?: if (total > 0) (done * 100 / total) else 0
    val itemPaused = display?.status == "paused"
    val notification =
      DownloadNotificationManager.buildOngoingNotification(
        ctx,
        title,
        body,
        pct,
        itemPaused,
      )
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    DownloadNotificationManager.safeNotify(
      ctx,
      DownloadNotificationManager.NOTIFICATION_ONGOING_ID,
      notification,
    )
  }

  fun getStateJson(): String = state.toJson().toString()

  /** Whether user pause is active (soft — current job may finish). */
  fun isPaused(): Boolean = paused.get()

  data class OrchestratorItem(
    val id: String,
    val url: String,
    val title: String,
    val status: String,
    val percent: Double,
    val options: List<List<String>>,
    val retryCount: Int,
    val lastBotErrorAt: Long,
    val cooldownUntil: Long,
    val filename: String?,
    val error: String?,
  ) {
    val isYoutube: Boolean get() = url.contains("youtube.com") || url.contains("youtu.be")
    val isBotError: Boolean get() = YtdlpPlugin.isYoutubeBotErrorPublic(error ?: "")
  }

  data class OrchestratorState(
    val items: List<OrchestratorItem> = emptyList(),
    val settings: JSONObject = JSONObject(),
    val activeId: String? = null,
    val globalBotStreak: Int = 0,
    val successCount: Int = 0,
    val pausedUntil: Long = 0L,
  ) {
    fun hasWork(): Boolean =
      items.any { it.status == "queued" || it.status == "downloading" } ||
        items.any { it.status == "error" && it.isYoutube && it.isBotError && it.retryCount < MAX_BOT_RETRIES }

    fun toJson(): JSONObject {
      val arr = JSONArray()
      items.forEach { item ->
        arr.put(
          JSONObject()
            .put("id", item.id)
            .put("url", item.url)
            .put("title", item.title)
            .put("status", item.status)
            .put("percent", item.percent)
            .put("retryCount", item.retryCount)
            .put("lastBotErrorAt", item.lastBotErrorAt)
            .put("cooldownUntil", item.cooldownUntil)
            .put("filename", item.filename)
            .put("error", item.error)
            .put(
              "options",
              JSONArray().apply {
                item.options.forEach { pair ->
                  put(JSONArray().apply { pair.forEach { put(it) } })
                }
              },
            ),
        )
      }
      return JSONObject()
        .put("items", arr)
        .put("settings", settings)
        .put("activeId", activeId)
        .put("globalBotStreak", globalBotStreak)
        .put("successCount", successCount)
        .put("pausedUntil", pausedUntil)
        .put("paused", paused.get())
    }

    companion object {
      /** Read optional string; JSONObject.optString turns JSON null into "null". */
      private fun JSONObject.optNullableString(key: String): String? {
        if (!has(key) || isNull(key)) return null
        val value = optString(key, "").trim()
        if (value.isEmpty() || value == "null") return null
        return value
      }

      fun fromJson(raw: String): OrchestratorState {
        val root = JSONObject(raw)
        val settings = root.optJSONObject("settings") ?: JSONObject()
        val itemsArr = root.optJSONArray("items") ?: JSONArray()
        val items = mutableListOf<OrchestratorItem>()
        for (i in 0 until itemsArr.length()) {
          val o = itemsArr.getJSONObject(i)
          val optArr = o.optJSONArray("options") ?: JSONArray()
          val options = mutableListOf<List<String>>()
          for (j in 0 until optArr.length()) {
            val pair = optArr.getJSONArray(j)
            options.add(List(pair.length()) { k -> pair.getString(k) })
          }
          items.add(
            OrchestratorItem(
              id = o.getString("id"),
              url = o.getString("url"),
              title = o.optString("title", o.getString("url")),
              status = o.optString("status", "queued"),
              percent = o.optDouble("percent", 0.0),
              options = options,
              retryCount = o.optInt("retryCount", 0),
              lastBotErrorAt = o.optLong("lastBotErrorAt", 0L),
              cooldownUntil = o.optLong("cooldownUntil", 0L),
              filename = o.optNullableString("filename"),
              error = o.optNullableString("error"),
            ),
          )
        }
        return OrchestratorState(
          items = items,
          settings = settings,
          activeId = root.optString("activeId", null),
          globalBotStreak = root.optInt("globalBotStreak", 0),
          successCount = root.optInt("successCount", 0),
          pausedUntil = root.optLong("pausedUntil", 0L),
        )
      }
    }
  }
}
