import type { VideoEntry } from "../types";
import { DownloadWizard } from "./DownloadWizard";

export interface DownloadDraft {
  quality: string;
  audioOnly: boolean;
  audioFormat: string;
  container: string;
  writeSubs: boolean;
  subLangs: string;
  writeThumbnail: boolean;
}

/** Selected video preview with stepped download wizard. */
export function VideoDetail({
  entry,
  onDownload,
  onAddQueue,
}: {
  entry: VideoEntry;
  onDownload: (draft: DownloadDraft) => void;
  onAddQueue: (draft: DownloadDraft) => void;
}) {
  return (
    <DownloadWizard
      entry={entry}
      onDownload={onDownload}
      onAddQueue={onAddQueue}
    />
  );
}
