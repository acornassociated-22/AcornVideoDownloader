package com.acorn.videodownloader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** System notifications for foreground download service and completion alerts. */
object DownloadNotificationManager {
  private const val TAG = "DownloadNotif"
  private const val BRAND_COLOR = 0xFF695CFE.toInt()

  const val CHANNEL_ONGOING = "acorn_downloads_ongoing"
  const val CHANNEL_ALERTS = "acorn_downloads_alerts"
  const val NOTIFICATION_ONGOING_ID = 7001
  const val NOTIFICATION_COMPLETE_ID = 7002
  const val NOTIFICATION_ERROR_ID = 7003

  /** Ensure notification channels exist (API 26+). */
  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val ongoing =
      NotificationChannel(
        CHANNEL_ONGOING,
        "Downloads in progress",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "Shows active playlist download progress"
        setShowBadge(false)
      }
    val alerts =
      NotificationChannel(
        CHANNEL_ALERTS,
        "Download alerts",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "Completion and error notifications"
      }
    manager.createNotificationChannel(ongoing)
    manager.createNotificationChannel(alerts)
  }

  /** True when the app may post notifications on this device. */
  fun canNotify(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled()

  /** Build the foreground ongoing notification. */
  fun buildOngoingNotification(
    context: Context,
    title: String,
    body: String,
    percent: Int,
    paused: Boolean,
  ): Notification {
    ensureChannels(context)
    val openQueue = openAppIntent(context, "queue")
    val toggleAction =
      if (paused) DownloadForegroundService.ACTION_RESUME else DownloadForegroundService.ACTION_PAUSE
    val toggleIntent = serviceActionIntent(context, toggleAction)
    val cancelIntent = serviceActionIntent(context, DownloadForegroundService.ACTION_CANCEL_ACTIVE)
    return NotificationCompat.Builder(context, CHANNEL_ONGOING)
      .setSmallIcon(R.drawable.ic_stat_acorn)
      .setColor(BRAND_COLOR)
      .setContentTitle(title)
      .setContentText(body)
      .setSubText(if (paused) "Paused" else null)
      .setProgress(100, percent.coerceIn(0, 100), false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openQueue)
      .addAction(
        if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
        if (paused) "Resume" else "Pause",
        toggleIntent,
      )
      .addAction(android.R.drawable.ic_delete, "Cancel", cancelIntent)
      .build()
  }

  /** Show a one-shot completion notification. */
  fun showCompleted(context: Context, title: String, body: String) {
    ensureChannels(context)
    if (!canNotify(context)) return
    val notification =
      NotificationCompat.Builder(context, CHANNEL_ALERTS)
        .setSmallIcon(R.drawable.ic_stat_acorn)
        .setColor(BRAND_COLOR)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setContentIntent(openAppIntent(context, "queue"))
        .build()
    safeNotify(context, NOTIFICATION_COMPLETE_ID, notification)
  }

  /** Show a one-shot bot/error notification. */
  fun showError(context: Context, title: String, body: String) {
    ensureChannels(context)
    if (!canNotify(context)) return
    val notification =
      NotificationCompat.Builder(context, CHANNEL_ALERTS)
        .setSmallIcon(R.drawable.ic_stat_acorn)
        .setColor(BRAND_COLOR)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setContentIntent(openAppIntent(context, "queue"))
        .build()
    safeNotify(context, NOTIFICATION_ERROR_ID, notification)
  }

  /** Post a notification, catching permission errors on API 33+. */
  fun safeNotify(context: Context, id: Int, notification: Notification) {
    if (!canNotify(context)) return
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (e: SecurityException) {
      Log.w(TAG, "safeNotify denied id=$id", e)
    }
  }

  private fun openAppIntent(context: Context, page: String): PendingIntent {
    val intent =
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(MainActivity.EXTRA_OPEN_PAGE, page)
      }
    return PendingIntent.getActivity(
      context,
      page.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun serviceActionIntent(context: Context, action: String): PendingIntent {
    val intent =
      Intent(context, DownloadForegroundService::class.java).apply {
        this.action = action
      }
    return PendingIntent.getService(
      context,
      action.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
