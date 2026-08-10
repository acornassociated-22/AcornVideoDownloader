package com.acorn.videodownloader

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.SharedPreferences
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.documentfile.provider.DocumentFile
import java.io.File
import java.io.FileInputStream

/** Shared staging + SAF/public export helpers for YtdlpPlugin and StoragePlugin. */
object ExportHelper {
  private const val TAG = "ExportHelper"
  const val PREFS_NAME = "acorn_export"
  const val STAGING_DIR_NAME = "AcornDownloads"
  private const val EXT_STORAGE_AUTH = "com.android.externalstorage.documents"
  private const val ACORN_FOLDER_REL = "Download/Acorn"

  data class ExportResult(
    val destination: String,
    val displayName: String,
    val mode: String,
  )

  /** Fixed public download folder: Downloads/Acorn (fallback: app-private staging). */
  fun downloadDir(activity: Activity): File {
    val public =
      File(
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
        "Acorn",
      )
    if (public.mkdirs() || public.isDirectory) {
      return public
    }
    Log.w(TAG, "public Download/Acorn unavailable — using app-private staging")
    return stagingDir(activity)
  }

  /** App-private directory where yt-dlp writes before export (legacy fallback). */
  fun stagingDir(activity: Activity): File =
    File(activity.filesDir, STAGING_DIR_NAME).also { it.mkdirs() }

  /** Normalize a SAF tree URI for stable persistence and comparison. */
  fun normalizeTreeUri(uri: Uri): Uri {
    if (uri.authority != EXT_STORAGE_AUTH) return uri
    val docId =
      try {
        DocumentsContract.getTreeDocumentId(uri)
      } catch (_: Exception) {
        return uri
      }
    return if (!docId.isNullOrBlank()) {
      DocumentsContract.buildTreeDocumentUri(EXT_STORAGE_AUTH, docId)
    } else {
      uri
    }
  }

  /** Persist read/write access to a picked SAF tree. */
  fun persistTreeAccess(activity: Activity, uri: Uri) {
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    activity.contentResolver.takePersistableUriPermission(uri, flags)
  }

  /** Copy a finished download into SAF tree or public Downloads/Acorn. */
  fun exportFile(
    activity: Activity,
    sourcePath: String,
    fileName: String? = null,
    treeUriOverride: String? = null,
  ): ExportResult {
    val prefs = activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
    val src = File(sourcePath)
    if (!src.isFile || src.length() <= 0L) {
      throw IllegalStateException("Source file missing: $sourcePath")
    }
    val baseName = fileName?.trim()?.takeIf { it.isNotEmpty() } ?: src.name
    val treeUri = treeUriOverride?.trim()?.takeIf { it.isNotEmpty() }
      ?: prefs.getString("tree_uri", null)
    if (!treeUri.isNullOrBlank()) {
      if (!hasTreeWriteAccess(activity, treeUri)) {
        Log.w(TAG, "SAF tree expired — clearing prefs and using public Downloads/Acorn")
        clearStaleTreeUri(prefs)
        Log.d(TAG, "export mode=public file=$baseName (saf fallback)")
        return exportToPublic(activity, src, baseName)
      }
      Log.d(TAG, "export mode=saf tree=$treeUri file=$baseName")
      return exportToSaf(activity, treeUri, src, baseName)
    }
    Log.d(TAG, "export mode=public file=$baseName")
    return exportToPublic(activity, src, baseName)
  }

  /**
   * Resolve a single folder-view intent without starting any activity.
   * Safe to call from a background thread.
   */
  fun resolveExportFolderIntent(
    activity: Activity,
    fileUriString: String? = null,
  ): Intent? {
    val trimmed = fileUriString?.trim()?.takeIf { it.isNotEmpty() }
    if (trimmed != null && (trimmed.startsWith("/storage") || trimmed.startsWith("/data"))) {
      return resolvePublicAcornIntent(activity)
    }

    val fileUri = trimmed?.let { Uri.parse(it) }

    fileUri?.let { uri ->
      resolveFolderForFileUri(activity, uri)?.let { return it }
    }

    val prefs = activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
    val treeUri = prefs.getString("tree_uri", null)
    if (!treeUri.isNullOrBlank()) {
      resolveSafTreeIntent(activity, Uri.parse(treeUri))?.let { return it }
    }

    return resolvePublicAcornIntent(activity)
  }

  /** Launch folder intent — tries direct start, OEM file managers, then chooser. */
  fun launchFolderIntent(activity: Activity, intent: Intent) {
    val base =
      Intent(intent).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    val candidates =
      listOf(
        base,
        Intent(base).apply {
          component =
            ComponentName(
              "com.google.android.documentsui",
              "com.android.documentsui.files.FilesActivity",
            )
        },
        Intent(base).apply {
          component =
            ComponentName(
              "com.android.documentsui",
              "com.android.documentsui.files.FilesActivity",
            )
        },
        Intent(base).apply { setPackage("com.huawei.hidisk") },
        Intent(base).apply { setPackage("com.huawei.filemanager") },
        Intent.createChooser(base, null),
      )
    for (candidate in candidates) {
      try {
        candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(candidate)
        return
      } catch (_: ActivityNotFoundException) {
        continue
      }
    }
    throw ActivityNotFoundException("No app can open the export folder")
  }

  /** @deprecated Use resolveExportFolderIntent + launchFolderIntent on UI thread. */
  fun openExportLocation(activity: Activity, fileUriString: String? = null) {
    val intent = resolveExportFolderIntent(activity, fileUriString)
      ?: throw IllegalStateException("No app can open the export folder")
    launchFolderIntent(activity, intent)
  }

  /** Current export folder label for UI. */
  fun folderInfo(prefs: SharedPreferences): Map<String, String?> {
    val uri = prefs.getString("tree_uri", null)
    val name = prefs.getString("display_name", null)
    return if (uri.isNullOrBlank()) {
      mapOf("treeUri" to null, "displayName" to "Downloads/Acorn", "mode" to "public")
    } else {
      mapOf("treeUri" to uri, "displayName" to (name ?: "Selected folder"), "mode" to "saf")
    }
  }

  private fun exportToSaf(
    activity: Activity,
    treeUri: String,
    src: File,
    fileName: String,
  ): ExportResult {
    validateTreeWriteAccess(activity, treeUri)
    val tree =
      DocumentFile.fromTreeUri(activity, Uri.parse(treeUri))
        ?: throw IllegalStateException("Invalid folder URI — re-select the folder in Settings")
    tree.findFile(fileName)?.delete()
    val dest =
      tree.createFile(guessMime(fileName), fileName)
        ?: throw IllegalStateException("Cannot create file in selected folder")
    activity.contentResolver.openOutputStream(dest.uri)?.use { out ->
      FileInputStream(src).use { input -> input.copyTo(out) }
    } ?: throw IllegalStateException("Cannot write to selected folder")
    return ExportResult(dest.uri.toString(), fileName, "saf")
  }

  /** Overwrite existing Downloads/Acorn file with the same name, then finish. */
  private fun exportToPublic(activity: Activity, src: File, fileName: String): ExportResult {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return exportToPublicMediaStore(activity, src, fileName)
    }
    removePublicDownloadCollisions(activity, fileName)
    val path =
      writePublicDownloadDirect(activity, src, fileName)
        ?: throw IllegalStateException("Cannot write to Downloads/Acorn")
    Log.d(TAG, "export overwrite file=$fileName")
    return ExportResult(path, fileName, "public")
  }

  /** API 29+ — MediaStore overwrite/insert; no direct File API on scoped storage. */
  private fun exportToPublicMediaStore(
    activity: Activity,
    src: File,
    fileName: String,
  ): ExportResult {
    try {
      findExistingDownloadUri(activity, fileName)?.let { existingUri ->
        overwriteMediaStoreDownload(activity, src, existingUri, fileName)?.let { uri ->
          Log.d(TAG, "export overwrite via MediaStore uri=$uri file=$fileName")
          return ExportResult(uri.toString(), fileName, "public")
        }
        Log.w(TAG, "MediaStore overwrite failed — clearing collisions before insert file=$fileName")
      }
      removePublicDownloadCollisions(activity, fileName)
      val destUri = writePublicDownloadInsert(activity, src, fileName)
      Log.d(TAG, "export insert via MediaStore uri=$destUri file=$fileName")
      return ExportResult(destUri.toString(), fileName, "public")
    } catch (e: Exception) {
      verifyPublicExport(activity, src, fileName)?.let { recovered ->
        Log.w(TAG, "export recovered after exception file=$fileName", e)
        return recovered
      }
      throw e
    }
  }

  /** If export threw but destination size matches staging, treat as success. */
  fun verifyPublicExport(activity: Activity, src: File, fileName: String): ExportResult? {
    val srcLen = src.length()
    if (srcLen <= 0L) return null
    findExistingDownloadUri(activity, fileName)?.let { uri ->
      if (mediaStoreSizeMatches(activity.contentResolver, uri, srcLen)) {
        return ExportResult(uri.toString(), fileName, "public")
      }
    }
    return null
  }

  /** Ensure persistable write access to the SAF tree is still granted. */
  private fun validateTreeWriteAccess(activity: Activity, treeUri: String) {
    if (!hasTreeWriteAccess(activity, treeUri)) {
      throw IllegalStateException("Folder access expired — re-select the folder in Settings")
    }
  }

  /** True when persistable write access to the SAF tree is still granted. */
  private fun hasTreeWriteAccess(activity: Activity, treeUri: String): Boolean {
    val targetId =
      try {
        DocumentsContract.getTreeDocumentId(Uri.parse(treeUri))
      } catch (_: Exception) {
        null
      }
    return activity.contentResolver.persistedUriPermissions.any { perm ->
      if (!perm.isWritePermission) return@any false
      if (targetId.isNullOrBlank()) {
        return@any perm.uri.toString() == treeUri
      }
      try {
        DocumentsContract.getTreeDocumentId(perm.uri) == targetId
      } catch (_: Exception) {
        perm.uri.toString() == treeUri
      }
    }
  }

  /** Remove expired SAF tree from prefs so export falls back to public. */
  private fun clearStaleTreeUri(prefs: SharedPreferences) {
    prefs.edit().remove("tree_uri").remove("display_name").apply()
  }

  /** Resolve parent folder intent for a MediaStore or SAF content URI. */
  private fun resolveFolderForFileUri(activity: Activity, fileUri: Uri): Intent? {
    if (DocumentsContract.isDocumentUri(activity, fileUri)) {
      return resolveDocumentParentIntent(activity, fileUri)
    }
    if (fileUri.authority == MediaStore.AUTHORITY ||
      fileUri.toString().contains("media/external")
    ) {
      return resolveMediaStoreFolderIntent(activity, fileUri)
    }
    DocumentFile.fromSingleUri(activity, fileUri)?.parentFile?.uri?.let { parent ->
      return firstResolvableFolderIntent(activity, listOf(parent))
    }
    return null
  }

  private fun resolveDocumentParentIntent(activity: Activity, docUri: Uri): Intent? {
    val docId =
      try {
        DocumentsContract.getDocumentId(docUri)
      } catch (_: Exception) {
        return null
      }
    val parentId = docId.substringBeforeLast('/', docId)
    if (parentId != docId) {
      return folderIntentForDocumentId(activity, parentId)
    }
    val treeId = parentId.substringBeforeLast('/')
    if (treeId.isNotEmpty() && treeId != parentId) {
      return folderIntentForDocumentId(activity, treeId)
    }
    return null
  }

  private fun resolveMediaStoreFolderIntent(activity: Activity, fileUri: Uri): Intent? {
    val projection = arrayOf(MediaStore.Downloads.RELATIVE_PATH)
    activity.contentResolver.query(fileUri, projection, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val relIdx = cursor.getColumnIndex(MediaStore.Downloads.RELATIVE_PATH)
      if (relIdx < 0) return null
      val rel = cursor.getString(relIdx)?.trim().orEmpty()
      if (rel.isEmpty()) return null
      val folderRel = rel.substringBeforeLast('/').ifBlank { rel }
      return folderIntentForDocumentId(activity, "primary:$folderRel")
    }
    return null
  }

  private fun resolveSafTreeIntent(activity: Activity, treeUri: Uri): Intent? {
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(treeUri, DocumentsContract.Document.MIME_TYPE_DIR)
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_ACTIVITY_NEW_TASK,
        )
      }
    return if (canHandle(activity, intent)) intent else null
  }

  private fun resolvePublicAcornIntent(activity: Activity): Intent? {
    val docCandidates =
      listOf(
        "primary:$ACORN_FOLDER_REL",
        "primary:Downloads/Acorn",
      ).map { DocumentsContract.buildDocumentUri(EXT_STORAGE_AUTH, it) }

    folderIntentForFirstDocumentId(activity, docCandidates)?.let { return it }

    buildAcornViaTree("primary:${Environment.DIRECTORY_DOWNLOADS}")?.let { uri ->
      firstResolvableFolderIntent(activity, listOf(uri))?.let { return it }
    }
    buildAcornViaTree("primary:Downloads")?.let { uri ->
      firstResolvableFolderIntent(activity, listOf(uri))?.let { return it }
    }

    acornFolderFromMediaStoreQuery(activity)?.let { return it }

    resolveDownloadsRootFallbackIntent(activity)?.let { return it }

    // Best-effort — some OEMs omit resolveActivity but still handle the intent.
    return buildFolderViewIntent(
      DocumentsContract.buildDocumentUri(EXT_STORAGE_AUTH, "primary:$ACORN_FOLDER_REL"),
    )
  }

  private fun buildAcornViaTree(treeDocId: String): Uri? {
    return try {
      val treeUri = DocumentsContract.buildTreeDocumentUri(EXT_STORAGE_AUTH, treeDocId)
      DocumentsContract.buildDocumentUriUsingTree(treeUri, "$treeDocId/Acorn")
    } catch (_: Exception) {
      null
    }
  }

  /** Query MediaStore once for any Acorn download and derive folder document URI. */
  private fun acornFolderFromMediaStoreQuery(activity: Activity): Intent? {
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    val projection = arrayOf(MediaStore.Downloads.RELATIVE_PATH)
    val selection = "${MediaStore.Downloads.RELATIVE_PATH} LIKE ?"
    val args = arrayOf("%${Environment.DIRECTORY_DOWNLOADS}/Acorn%")
    activity.contentResolver.query(
      collection,
      projection,
      selection,
      args,
      "${MediaStore.Downloads.DATE_MODIFIED} DESC",
    )?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val relIdx = cursor.getColumnIndex(MediaStore.Downloads.RELATIVE_PATH)
      if (relIdx < 0) return null
      val rel = cursor.getString(relIdx)?.trim().orEmpty()
      if (rel.isEmpty()) return null
      val folderRel = rel.substringBeforeLast('/').ifBlank { ACORN_FOLDER_REL }
      return folderIntentForDocumentId(activity, "primary:$folderRel")
    }
    return null
  }

  private fun folderIntentForFirstDocumentId(
    activity: Activity,
    uris: List<Uri>,
  ): Intent? = firstResolvableFolderIntent(activity, uris)

  private fun folderIntentForDocumentId(activity: Activity, documentId: String): Intent? {
    val uri = DocumentsContract.buildDocumentUri(EXT_STORAGE_AUTH, documentId)
    return firstResolvableFolderIntent(activity, listOf(uri))
  }

  private fun firstResolvableFolderIntent(activity: Activity, uris: List<Uri>): Intent? {
    for (uri in uris) {
      val intent = buildFolderViewIntent(uri)
      if (canHandle(activity, intent)) return intent
    }
    return null
  }

  private fun buildFolderViewIntent(uri: Uri): Intent =
    Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

  private fun canHandle(activity: Activity, intent: Intent): Boolean =
    intent.resolveActivity(activity.packageManager) != null

  private fun resolveDownloadsRootFallbackIntent(activity: Activity): Intent? {
    val fallback =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          DocumentsContract.Document.MIME_TYPE_DIR,
        )
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    return if (canHandle(activity, fallback)) fallback else null
  }

  /** Target path under public Downloads/Acorn for a file name. */
  private fun acornPublicFile(fileName: String): File =
    File(
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
      "Acorn/$fileName",
    )

  /** Legacy/direct copy — deletes any existing file first (overwrite). */
  private fun writePublicDownloadDirect(
    activity: Activity,
    src: File,
    fileName: String,
  ): String? {
    val dest = acornPublicFile(fileName)
    dest.parentFile?.mkdirs()
    if (dest.isFile && !dest.delete()) {
      Log.w(TAG, "could not remove existing file for overwrite ${dest.absolutePath}")
    }
    return try {
      src.inputStream().use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      }
      if (dest.isFile && dest.length() > 0L) {
        scanPublicFile(activity, dest)
        dest.absolutePath
      } else {
        null
      }
    } catch (e: Exception) {
      Log.w(TAG, "direct public overwrite failed", e)
      null
    }
  }

  /** Notify MediaStore that a direct-written file exists in Downloads/Acorn. */
  private fun scanPublicFile(activity: Activity, file: File) {
    try {
      MediaScannerConnection.scanFile(
        activity,
        arrayOf(file.absolutePath),
        arrayOf(guessMime(file.name)),
        null,
      )
    } catch (e: Exception) {
      Log.w(TAG, "MediaScanner scan failed", e)
    }
  }

  /** Remove stale MediaStore rows (and legacy filesystem file on API 28-). */
  private fun removePublicDownloadCollisions(activity: Activity, fileName: String) {
    val stale = acornPublicFile(fileName)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      if (stale.isFile) {
        try {
          if (!stale.delete()) {
            Log.w(TAG, "could not delete stale public file ${stale.absolutePath}")
          }
        } catch (e: Exception) {
          Log.w(TAG, "delete stale public file failed", e)
        }
      }
    }
    deleteMediaStoreEntries(activity, fileName, stale.absolutePath)
  }

  /** Delete MediaStore Download entries that block overwrite (name or _DATA path). */
  private fun deleteMediaStoreEntries(
    activity: Activity,
    displayName: String,
    dataPath: String? = null,
  ) {
    val resolver = activity.contentResolver
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    deleteMediaStoreQuery(
      resolver,
      collection,
      "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} LIKE ?",
      arrayOf(
        displayName,
        "%${Environment.DIRECTORY_DOWNLOADS}/Acorn%",
      ),
    )
    if (!dataPath.isNullOrBlank()) {
      deleteMediaStoreQuery(
        resolver,
        collection,
        "${MediaStore.Downloads.DATA} = ?",
        arrayOf(dataPath),
      )
      deleteMediaStoreQuery(
        resolver,
        collection,
        "${MediaStore.Downloads.DATA} LIKE ?",
        arrayOf("%/Acorn/${displayName}"),
      )
    }
  }

  private fun deleteMediaStoreQuery(
    resolver: android.content.ContentResolver,
    collection: Uri,
    selection: String,
    args: Array<String>,
  ) {
    resolver.query(collection, arrayOf(MediaStore.Downloads._ID), selection, args, null)?.use { cursor ->
      val idIdx = cursor.getColumnIndex(MediaStore.Downloads._ID)
      if (idIdx < 0) return@use
      while (cursor.moveToNext()) {
        val id = cursor.getLong(idIdx)
        try {
          resolver.delete(ContentUris.withAppendedId(collection, id), null, null)
        } catch (e: Exception) {
          Log.w(TAG, "MediaStore delete failed id=$id", e)
        }
      }
    }
  }

  /** Find an existing Downloads/Acorn MediaStore entry; delete duplicate rows. */
  private fun findExistingDownloadUri(activity: Activity, fileName: String): Uri? {
    val resolver = activity.contentResolver
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    val expectedPath = acornPublicFile(fileName).absolutePath
    val acornRel = "%${Environment.DIRECTORY_DOWNLOADS}/Acorn%"

    findDownloadUriByQuery(
      resolver,
      collection,
      "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} LIKE ?",
      arrayOf(fileName, acornRel),
    )?.let { return it }

    findDownloadUriByQuery(
      resolver,
      collection,
      "${MediaStore.Downloads.DATA} = ?",
      arrayOf(expectedPath),
    )?.let { return it }

    return findDownloadUriByQuery(
      resolver,
      collection,
      "${MediaStore.Downloads.DATA} LIKE ?",
      arrayOf("%/Acorn/$fileName"),
    )
  }

  /** Query MediaStore Downloads; keep first match, delete duplicate rows. */
  private fun findDownloadUriByQuery(
    resolver: android.content.ContentResolver,
    collection: Uri,
    selection: String,
    args: Array<String>,
  ): Uri? {
    var keepUri: Uri? = null
    resolver.query(collection, arrayOf(MediaStore.Downloads._ID), selection, args, null)?.use { cursor ->
      val idIdx = cursor.getColumnIndex(MediaStore.Downloads._ID)
      if (idIdx < 0) return@use
      while (cursor.moveToNext()) {
        val id = cursor.getLong(idIdx)
        val uri = ContentUris.withAppendedId(collection, id)
        if (keepUri == null) {
          keepUri = uri
        } else {
          try {
            resolver.delete(uri, null, null)
          } catch (e: Exception) {
            Log.w(TAG, "MediaStore duplicate delete failed id=$id", e)
          }
        }
      }
    }
    return keepUri
  }

  /** Overwrite bytes into an existing MediaStore Downloads URI (truncate mode on Q+). */
  private fun overwriteMediaStoreDownload(
    activity: Activity,
    src: File,
    uri: Uri,
    fileName: String,
  ): Uri? {
    val resolver = activity.contentResolver
    return try {
      val out =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          resolver.openOutputStream(uri, "wt")
        } else {
          resolver.openOutputStream(uri)
        }
      out?.use { output ->
        FileInputStream(src).use { input -> input.copyTo(output) }
      } ?: return null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values =
          ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          }
        try {
          resolver.update(uri, values, null, null)
        } catch (e: Exception) {
          Log.w(TAG, "MediaStore finalize after overwrite failed uri=$uri", e)
        }
      }
      if (mediaStoreSizeMatches(resolver, uri, src.length())) uri else null
    } catch (e: Exception) {
      Log.w(TAG, "MediaStore overwrite failed uri=$uri", e)
      null
    }
  }

  /** True when a MediaStore entry size is within 95% of expected. */
  private fun mediaStoreSizeMatches(
    resolver: android.content.ContentResolver,
    uri: Uri,
    expectedLen: Long,
  ): Boolean {
    if (expectedLen <= 0L) return false
    val threshold = expectedLen * 95 / 100
    try {
      resolver.openFileDescriptor(uri, "r")?.use { pfd ->
        return pfd.statSize >= threshold
      }
    } catch (e: Exception) {
      Log.w(TAG, "MediaStore size check failed uri=$uri", e)
    }
    return false
  }

  /** Insert a new Downloads/Acorn MediaStore entry and write staging bytes. */
  private fun writePublicDownloadInsert(activity: Activity, src: File, fileName: String): Uri {
    val resolver = activity.contentResolver
    val values =
      ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
        put(MediaStore.Downloads.MIME_TYPE, guessMime(fileName))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Acorn")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
      }
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    val uri =
      resolver.insert(collection, values)
        ?: throw IllegalStateException("MediaStore insert failed — cannot write to Downloads/Acorn")
    try {
      resolver.openOutputStream(uri)?.use { out ->
        FileInputStream(src).use { input -> input.copyTo(out) }
      } ?: throw IllegalStateException("Cannot write to Downloads/Acorn")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        try {
          resolver.update(uri, values, null, null)
        } catch (e: Exception) {
          if (mediaStoreSizeMatches(resolver, uri, src.length())) {
            Log.w(TAG, "MediaStore finalize failed but bytes verified uri=$uri", e)
            return uri
          }
          try {
            resolver.delete(uri, null, null)
          } catch (_: Exception) {
          }
          throw e
        }
      }
    } catch (e: Exception) {
      try {
        resolver.delete(uri, null, null)
      } catch (_: Exception) {
      }
      throw e
    }
    return uri
  }

  private fun guessMime(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
      ?: "application/octet-stream"
  }
}
