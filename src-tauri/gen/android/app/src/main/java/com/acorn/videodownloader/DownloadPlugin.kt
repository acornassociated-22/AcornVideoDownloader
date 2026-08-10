package com.acorn.videodownloader

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SyncOrchestratorArgs {
  lateinit var json: String
}

@InvokeArg
class DownloadIdArgs {
  lateinit var id: String
}

@InvokeArg
class ForceRefreshArgs {
  var force: Boolean = false
}

@InvokeArg
class AndroidLogArgs {
  lateinit var tag: String
  lateinit var message: String
}

/** Tauri bridge for foreground download service and native orchestrator. */
@TauriPlugin
class DownloadPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val TAG = "DownloadPlugin"
    const val REQ_POST_NOTIFICATIONS = 9101

    @Volatile
    private var pendingNotificationInvoke: Invoke? = null

    /** Resolve a pending notification permission request from MainActivity. */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) {
      if (requestCode != REQ_POST_NOTIFICATIONS) return
      val invoke = pendingNotificationInvoke ?: return
      pendingNotificationInvoke = null
      val granted =
        grantResults.isNotEmpty() &&
          grantResults[0] == PackageManager.PERMISSION_GRANTED
      val result = JSObject()
      result.put("granted", granted)
      result.put("requested", true)
      invoke.resolve(result)
    }
  }

  @Command
  fun ensureDownloadService(invoke: Invoke) {
    DownloadForegroundService.ensureRunning(activity)
    DownloadOrchestrator.restore(activity.applicationContext)
    invoke.resolve(JSObject())
  }

  @Command
  fun syncOrchestratorQueue(invoke: Invoke) {
    val args = invoke.parseArgs(SyncOrchestratorArgs::class.java)
    DownloadOrchestrator.syncFromJson(activity.applicationContext, args.json)
    invoke.resolve(JSObject())
  }

  @Command
  fun getOrchestratorState(invoke: Invoke) {
    val result = JSObject()
    result.put("state", DownloadOrchestrator.getStateJson())
    invoke.resolve(result)
  }

  @Command
  fun pauseOrchestrator(invoke: Invoke) {
    DownloadOrchestrator.pause(activity.applicationContext)
    invoke.resolve(JSObject())
  }

  @Command
  fun resumeOrchestrator(invoke: Invoke) {
    DownloadOrchestrator.resume(activity.applicationContext)
    invoke.resolve(JSObject())
  }

  @Command
  fun pauseActiveJob(invoke: Invoke) {
    DownloadOrchestrator.pauseActiveJob(activity.applicationContext)
    invoke.resolve(JSObject())
  }

  @Command
  fun resumeOrchestratorJob(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadIdArgs::class.java)
    DownloadOrchestrator.resumeJob(activity.applicationContext, args.id)
    invoke.resolve(JSObject())
  }

  @Command
  fun retryOrchestratorJob(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadIdArgs::class.java)
    DownloadOrchestrator.retryJob(activity.applicationContext, args.id)
    invoke.resolve(JSObject())
  }

  @Command
  fun cancelOrchestratorJob(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadIdArgs::class.java)
    DownloadOrchestrator.cancelJob(activity.applicationContext, args.id)
    invoke.resolve(JSObject())
  }

  @Command
  fun requeueFailedBotItems(invoke: Invoke) {
    DownloadOrchestrator.requeueFailedBotItems(activity.applicationContext)
    invoke.resolve(JSObject())
  }

  @Command
  fun requestNotificationPermission(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      val result = JSObject()
      result.put("granted", true)
      invoke.resolve(result)
      return
    }
    val granted =
      ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    if (granted) {
      val result = JSObject()
      result.put("granted", true)
      invoke.resolve(result)
      return
    }
    ActivityCompat.requestPermissions(
      activity,
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      REQ_POST_NOTIFICATIONS,
    )
    pendingNotificationInvoke = invoke
  }

  @Command
  fun getPendingNavigation(invoke: Invoke) {
    val nav = DownloadServiceHolder.consumePendingNavigation()
    val result = JSObject()
    if (nav.sharedUrl != null) result.put("sharedUrl", nav.sharedUrl)
    if (nav.openPage != null) result.put("openPage", nav.openPage)
    invoke.resolve(result)
  }

  @Command
  fun openYoutubeLogin(invoke: Invoke) {
    val intent = Intent(activity, YoutubeLoginActivity::class.java)
    activity.startActivity(intent)
    invoke.resolve(JSObject())
  }

  @Command
  fun checkYtdlpUpdate(invoke: Invoke) {
    val force =
      try {
        invoke.parseArgs(ForceRefreshArgs::class.java).force
      } catch (_: Exception) {
        false
      }
    Log.i(TAG, "checkYtdlpUpdate invoked force=$force")
    ioExecutor.execute {
      try {
        val info = YtdlpUpdater.checkForUpdate(activity.applicationContext, force)
        val result = JSObject()
        result.put("currentVersion", info.currentVersion)
        result.put("latestVersion", info.latestVersion)
        result.put("updateAvailable", info.updateAvailable)
        result.put("downloadUrl", info.downloadUrl)
        result.put("sha256", info.sha256)
        Log.i(
          TAG,
          "checkYtdlpUpdate done current=${info.currentVersion} latest=${info.latestVersion} available=${info.updateAvailable}",
        )
        activity.runOnUiThread { invoke.resolve(result) }
      } catch (e: Exception) {
        Log.e(TAG, "checkYtdlpUpdate failed", e)
        activity.runOnUiThread {
          invoke.reject(e.message ?: "Update check failed")
        }
      }
    }
  }

  @Command
  fun applyYtdlpUpdate(invoke: Invoke) {
    Log.i(TAG, "applyYtdlpUpdate invoked")
    ioExecutor.execute {
      try {
        val applied = YtdlpUpdater.applyUpdate(activity.applicationContext)
        val result = JSObject()
        result.put("success", applied.success)
        result.put("version", applied.version)
        result.put("error", applied.error)
        Log.i(
          TAG,
          "applyYtdlpUpdate done success=${applied.success} version=${applied.version} error=${applied.error}",
        )
        activity.runOnUiThread { invoke.resolve(result) }
      } catch (e: Exception) {
        Log.e(TAG, "applyYtdlpUpdate failed", e)
        activity.runOnUiThread {
          invoke.reject(e.message ?: "Update failed")
        }
      }
    }
  }

  /** Mirror JS console logs into logcat for on-device debugging. */
  @Command
  fun androidLog(invoke: Invoke) {
    val args = invoke.parseArgs(AndroidLogArgs::class.java)
    Log.d("AcornJS/${args.tag}", args.message)
    invoke.resolve(JSObject())
  }

  @Command
  fun getYtdlpVersion(invoke: Invoke) {
    val result = JSObject()
    result.put("version", YtdlpUpdater.currentVersion(activity.applicationContext))
    invoke.resolve(result)
  }

  @Command
  fun openBatteryOptimizationSettings(invoke: Invoke) {
    val ctx = activity.applicationContext
    val pkg = ctx.packageName
    val pm = ctx.packageManager
    val candidates =
      listOf(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:$pkg")
        },
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.fromParts("package", pkg, null)
        },
        Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),
        Intent().apply {
          component =
            ComponentName(
              "com.miui.securitycenter",
              "com.miui.powercenter.PowerSettings",
            )
        },
        Intent(Settings.ACTION_SETTINGS),
      )
    for (intent in candidates) {
      try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(pm) != null) {
          activity.startActivity(intent)
          invoke.resolve(JSObject())
          return
        }
      } catch (e: Exception) {
        Log.w(TAG, "battery settings intent failed: ${intent.action}", e)
      }
    }
    invoke.reject("No battery settings screen available on this device")
  }

  private val ioExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
}
