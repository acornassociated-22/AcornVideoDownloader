package com.acorn.videodownloader

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors

/** SAF export / open helpers for Rust android_storage plugin. */
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
  private val prefs
    get() = activity.getSharedPreferences(ExportHelper.PREFS_NAME, Activity.MODE_PRIVATE)

  private var pendingPick: Invoke? = null
  private var pendingCookiesPick: Invoke? = null
  private val ioExecutor = Executors.newSingleThreadExecutor()

  companion object {
    private const val TAG = "StoragePlugin"
  }

  @Command
  fun pickExportFolder(invoke: Invoke) {
    pendingPick = invoke
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
      }
    startActivityForResult(invoke, intent, "onFolderPicked")
  }

  @Command
  fun pickCookiesFile(invoke: Invoke) {
    pendingCookiesPick = invoke
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "text/*"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    startActivityForResult(invoke, intent, "onCookiesPicked")
  }

  @Command
  fun getExportFolder(invoke: Invoke) {
    invoke.resolve(folderInfo())
  }

  @Command
  fun clearExportFolder(invoke: Invoke) {
    val uri = prefs.getString("tree_uri", null)
    if (uri != null) {
      try {
        activity.contentResolver.releasePersistableUriPermission(
          Uri.parse(uri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
      } catch (_: Exception) {
      }
    }
    prefs.edit().remove("tree_uri").remove("display_name").apply()
    invoke.resolve(folderInfo())
  }

  @Command
  fun exportFile(invoke: Invoke) {
    val args = invoke.parseArgs(JSObject::class.java)
    val sourcePath =
      args.getString("sourcePath") ?: run {
        invoke.reject("sourcePath required")
        return
      }
    val fileName = args.getString("fileName")
    val treeUri = args.getString("treeUri")
    try {
      val exported = ExportHelper.exportFile(activity, sourcePath, fileName, treeUri)
      val result = JSObject()
      result.put("destination", exported.destination)
      result.put("displayName", exported.displayName)
      result.put("mode", exported.mode)
      invoke.resolve(result)
    } catch (e: Exception) {
      invoke.reject(e.message ?: "export failed")
    }
  }

  @Command
  fun openFile(invoke: Invoke) {
    val args = invoke.parseArgs(JSObject::class.java)
    val path = args.getString("path")?.trim().orEmpty()
    try {
      when {
        path.startsWith("content://") -> {
          val uri = Uri.parse(path)
          val mime = activity.contentResolver.getType(uri) ?: guessMime(path)
          launchView(uri, mime)
        }
        path.isNotEmpty() -> {
          val file = File(path)
          if (file.isFile) {
            val uri =
              FileProvider.getUriForFile(
                activity,
                activity.packageName + ".fileprovider",
                file,
              )
            launchView(uri, guessMime(file.name))
          } else {
            openExportFolderAsync(invoke, null)
            return
          }
        }
        else -> {
          openExportFolderAsync(invoke, null)
          return
        }
      }
      invoke.resolve(JSObject())
    } catch (e: Exception) {
      invoke.reject(e.message ?: "open failed")
    }
  }

  @Command
  fun openExportFolder(invoke: Invoke) {
    val args = invoke.parseArgs(JSObject::class.java)
    val path = args.getString("path")?.trim().orEmpty().ifBlank { null }
    openExportFolderAsync(invoke, path)
  }

  /** Resolve folder intent off the UI thread; launch a single activity on main. */
  private fun openExportFolderAsync(invoke: Invoke, path: String?) {
    ioExecutor.execute {
      try {
        val intent = ExportHelper.resolveExportFolderIntent(activity, path)
        activity.runOnUiThread {
          try {
            if (intent == null) {
              Log.w(TAG, "openExportFolder: no intent path=$path")
              invoke.reject("No app can open the export folder")
              return@runOnUiThread
            }
            Log.d(TAG, "openExportFolder: launching path=$path intent=$intent")
            ExportHelper.launchFolderIntent(activity, intent)
            invoke.resolve(JSObject())
          } catch (e: Exception) {
            Log.w(TAG, "openExportFolder failed path=$path", e)
            invoke.reject(e.message ?: "open folder failed")
          }
        }
      } catch (e: Exception) {
        activity.runOnUiThread {
          Log.w(TAG, "openExportFolder resolve failed path=$path", e)
          invoke.reject(e.message ?: "open folder failed")
        }
      }
    }
  }

  /** Launch ACTION_VIEW for a content or file URI. */
  private fun launchView(uri: Uri, mime: String) {
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    activity.startActivity(Intent.createChooser(intent, null))
  }

  @Suppress("UNUSED_PARAMETER")
  fun onCookiesPicked(invoke: Invoke, result: ActivityResult) {
    val pending = pendingCookiesPick
    pendingCookiesPick = null
    if (pending == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      pending.reject("cancelled")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      pending.reject("no uri")
      return
    }
    ioExecutor.execute {
      try {
        val temp = File(activity.cacheDir, "import-cookies-${System.currentTimeMillis()}.txt")
        activity.contentResolver.openInputStream(uri)?.use { input ->
          temp.outputStream().use { output -> input.copyTo(output) }
        } ?: run {
          activity.runOnUiThread { pending.reject("cannot read file") }
          return@execute
        }
        val ok = CookieBootstrap.importCookiesFile(activity, temp)
        temp.delete()
        val st = CookieBootstrap.status(activity)
        activity.runOnUiThread {
          val obj = JSObject()
          obj.put("imported", ok)
          obj.put("authenticated", st.authenticated)
          obj.put("path", st.path)
          obj.put("state", st.state)
          pending.resolve(obj)
        }
      } catch (e: Exception) {
        activity.runOnUiThread {
          pending.reject(e.message ?: "import failed")
        }
      }
    }
  }

  @Suppress("UNUSED_PARAMETER")
  fun onFolderPicked(invoke: Invoke, result: ActivityResult) {
    val pending = pendingPick
    pendingPick = null
    if (pending == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      pending.reject("cancelled")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      pending.reject("no uri")
      return
    }
    val normalized = ExportHelper.normalizeTreeUri(uri)
    try {
      ExportHelper.persistTreeAccess(activity, normalized)
    } catch (e: Exception) {
      pending.reject("Cannot persist folder access: ${e.message}")
      return
    }
    val tree = DocumentFile.fromTreeUri(activity, normalized)
    if (tree == null || !tree.canWrite()) {
      pending.reject("Selected folder is not writable — pick another folder")
      return
    }
    val name = tree.name ?: "Selected folder"
    prefs.edit().putString("tree_uri", normalized.toString()).putString("display_name", name).apply()
    pending.resolve(folderInfo())
  }

  private fun folderInfo(): JSObject {
    val info = ExportHelper.folderInfo(prefs)
    val obj = JSObject()
    obj.put("treeUri", info["treeUri"])
    obj.put("displayName", info["displayName"])
    obj.put("mode", info["mode"])
    return obj
  }

  private fun guessMime(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
      ?: "application/octet-stream"
  }
}
