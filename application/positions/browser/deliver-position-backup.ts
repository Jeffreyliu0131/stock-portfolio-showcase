import type { PositionBackupFile } from "../position-backup.ts";

export type PositionBackupDeliveryResult =
  | "shared"
  | "downloaded"
  | "cancelled";

interface ShareNavigator {
  readonly canShare?: (data?: ShareData) => boolean;
  readonly share?: (data?: ShareData) => Promise<void>;
}

export interface PositionBackupDeliveryEnvironment {
  readonly navigator: ShareNavigator;
  readonly document: Document;
  readonly url: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly createBlob: (
    parts: BlobPart[],
    options: BlobPropertyBag,
  ) => Blob;
  readonly createFile?: (
    parts: BlobPart[],
    fileName: string,
    options: FilePropertyBag,
  ) => File;
  readonly scheduleRevoke: (callback: () => void) => void;
}

function defaultEnvironment(): PositionBackupDeliveryEnvironment {
  return {
    navigator: globalThis.navigator,
    document: globalThis.document,
    url: globalThis.URL,
    createBlob: (parts, options) => new Blob(parts, options),
    ...(typeof File === "undefined"
      ? {}
      : {
          createFile: (parts, fileName, options) =>
            new File(parts, fileName, options),
        }),
    scheduleRevoke: (callback) => {
      globalThis.setTimeout(callback, 60_000);
    },
  };
}

function shareWasCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function canShareFile(
  navigator: ShareNavigator,
  shareData: ShareData,
): boolean {
  if (navigator.share === undefined) {
    return false;
  }
  try {
    return navigator.canShare?.(shareData) ?? true;
  } catch {
    return false;
  }
}

export async function deliverPositionBackup(
  backupFile: PositionBackupFile,
  environment: PositionBackupDeliveryEnvironment = defaultEnvironment(),
): Promise<PositionBackupDeliveryResult> {
  const blob = environment.createBlob([backupFile.contents], {
    type: backupFile.mediaType,
  });
  const shareFile = environment.createFile?.(
    [backupFile.contents],
    backupFile.fileName,
    { type: backupFile.mediaType },
  );

  if (shareFile !== undefined) {
    const shareData: ShareData = {
      files: [shareFile],
      title: "持仓 JSON 备份",
    };
    if (canShareFile(environment.navigator, shareData)) {
      try {
        await environment.navigator.share!(shareData);
        return "shared";
      } catch (error) {
        if (shareWasCancelled(error)) {
          return "cancelled";
        }
        // If file sharing is unavailable after feature detection,
        // fall back to a local Blob download.
      }
    }
  }

  const objectUrl = environment.url.createObjectURL(blob);
  try {
    const anchor = environment.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = backupFile.fileName;
    anchor.rel = "noopener";
    anchor.hidden = true;
    environment.document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    environment.url.revokeObjectURL(objectUrl);
    throw error;
  }
  environment.scheduleRevoke(() => {
    environment.url.revokeObjectURL(objectUrl);
  });
  return "downloaded";
}
