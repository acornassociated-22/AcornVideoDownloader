import { invoke } from "@tauri-apps/api/core";

export type ExportFolderInfo = {
  treeUri: string | null;
  displayName: string;
  mode: "saf" | "public" | string;
};

/** Open the SAF tree picker and persist write access. */
export function pickExportFolder(): Promise<ExportFolderInfo> {
  return invoke("pick_export_folder");
}

/** Read the current export folder (SAF or public Downloads/Acorn). */
export function getExportFolder(): Promise<ExportFolderInfo> {
  return invoke("get_export_folder");
}

/** Clear SAF selection and use public Downloads/Acorn. */
export function clearExportFolder(): Promise<ExportFolderInfo> {
  return invoke("clear_export_folder");
}

/** Copy a finished download into the chosen export folder. */
export function exportDownloadedFile(
  sourcePath: string,
  fileName?: string | null,
): Promise<string> {
  return invoke("export_downloaded_file", {
    sourcePath,
    fileName: fileName ?? null,
  });
}

/** Open the configured export folder (SAF tree or Downloads/Acorn). */
export function openExportFolder(path?: string | null): Promise<void> {
  return invoke("open_export_folder", {
    path: path?.trim() || null,
  });
}

export type CookieImportResult = {
  imported: boolean;
  authenticated: boolean;
  path: string;
  state: string;
};

/** Pick cookies.txt via SAF and import into app storage (Android). */
export function pickCookiesFile(): Promise<CookieImportResult> {
  return invoke("pick_cookies_file");
}
