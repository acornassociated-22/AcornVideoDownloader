package com.acorn.videodownloader

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat

/** Keeps download orchestration alive while playlist runs in background. */
class DownloadForegroundService : Service() {
  companion object {
    private const val TAG = "DownloadFGS"
    const val ACTION_START = "com.acorn.videodownloader.action.START_DOWNLOADS"
    const val ACTION_STOP = "com.acorn.videodownloader.action.STOP_DOWNLOADS"
    const val ACTION_PAUSE = "com.acorn.videodownloader.action.PAUSE"
    const val ACTION_RESUME = "com.acorn.videodownloader.action.RESUME"
    const val ACTION_CANCEL_ACTIVE = "com.acorn.videodownloader.action.CANCEL_ACTIVE"

    /** Start foreground service if not already running. */
    fun ensureRunning(context: Context) {
      val intent = Intent(context, DownloadForegroundService::class.java).apply {
        action = ACTION_START
      }
      ContextCompat.startForegroundService(context, intent)
    }

    /** Request service stop when queue is idle. */
    fun requestStop(context: Context) {
      val intent = Intent(context, DownloadForegroundService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }

  @Volatile
  private var started = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    DownloadNotificationManager.ensureChannels(this)
    Log.d(TAG, "onCreate")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        DownloadOrchestrator.stop(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        started = false
        return START_NOT_STICKY
      }
      ACTION_PAUSE -> DownloadOrchestrator.pauseActiveJob(this)
      ACTION_RESUME -> DownloadOrchestrator.resumePausedJob(this)
      ACTION_CANCEL_ACTIVE -> DownloadOrchestrator.cancelActive()
      else -> {
        if (!started) {
          val notification =
            DownloadNotificationManager.buildOngoingNotification(
              this,
              "Acorn",
              "Preparing downloads…",
              0,
              false,
            )
          startForegroundWithType(notification)
          started = true
        }
        DownloadOrchestrator.ensureLoop(this)
      }
    }
    return START_STICKY
  }

  /** Start foreground with dataSync type on API 34+. */
  private fun startForegroundWithType(notification: android.app.Notification) {
    val id = DownloadNotificationManager.NOTIFICATION_ONGOING_ID
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(id, notification)
    }
  }

  override fun onDestroy() {
    DownloadWakeLock.release()
    DownloadOrchestrator.stop(this)
    started = false
    Log.d(TAG, "onDestroy")
    super.onDestroy()
  }
}
