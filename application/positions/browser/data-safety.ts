import { rfc3339ToEpochNanoseconds } from "../../../domain/time.ts";

export type StoragePersistenceStatus =
  | "unsupported"
  | "unknown"
  | "best-effort"
  | "persistent";

interface PersistenceStorageManager {
  readonly persisted?: () => Promise<unknown>;
  readonly persist?: () => Promise<unknown>;
}

const STORAGE_MANAGER_ACCESS_FAILED = Symbol("storage-manager-access-failed");
type StorageManagerResolution =
  | PersistenceStorageManager
  | null
  | typeof STORAGE_MANAGER_ACCESS_FAILED;

interface DataSafetyMetadataStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export interface BrowserDataSafetyEnvironment {
  readonly navigatorStorage?: PersistenceStorageManager | null;
  readonly localStorage?: DataSafetyMetadataStorage | null;
}

export interface DataSafetyMetadata {
  /** This browser generated JSON contents; external file delivery is unknown. */
  readonly lastBackupGeneratedAt: string | null;
  /** This browser completed an application restore successfully. */
  readonly lastSuccessfulRestoreAt: string | null;
}

export const LAST_BACKUP_GENERATED_AT_STORAGE_KEY =
  "stock-portfolio:data-safety:last-backup-generated-at:v1";

export const LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY =
  "stock-portfolio:data-safety:last-successful-restore-at:v1";

function browserNavigatorStorage(): StorageManagerResolution {
  try {
    return typeof navigator === "undefined"
      ? null
      : (navigator.storage ?? null);
  } catch {
    return STORAGE_MANAGER_ACCESS_FAILED;
  }
}

function browserLocalStorage(): DataSafetyMetadataStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function navigatorStorage(
  environment: BrowserDataSafetyEnvironment | undefined,
): StorageManagerResolution {
  if (environment === undefined) {
    return browserNavigatorStorage();
  }
  try {
    return environment.navigatorStorage ?? null;
  } catch {
    return STORAGE_MANAGER_ACCESS_FAILED;
  }
}

function metadataStorage(
  environment: BrowserDataSafetyEnvironment | undefined,
): DataSafetyMetadataStorage | null {
  if (environment === undefined) {
    return browserLocalStorage();
  }
  try {
    return environment.localStorage ?? null;
  } catch {
    return null;
  }
}

async function readPersisted(
  storageManager: PersistenceStorageManager,
): Promise<StoragePersistenceStatus> {
  try {
    const persisted = storageManager.persisted;
    if (typeof persisted !== "function") {
      return "unsupported";
    }
    return persistenceStatusFromResult(
      await persisted.call(storageManager),
    );
  } catch {
    // Failure to verify persistence must not block access to local data.
    return "unknown";
  }
}

function persistenceStatusFromResult(
  result: unknown,
): Exclude<StoragePersistenceStatus, "unsupported"> {
  if (result === true) {
    return "persistent";
  }
  if (result === false) {
    return "best-effort";
  }
  return "unknown";
}

export async function readStoragePersistenceStatus(
  environment?: BrowserDataSafetyEnvironment,
): Promise<StoragePersistenceStatus> {
  const storageManager = navigatorStorage(environment);
  if (storageManager === STORAGE_MANAGER_ACCESS_FAILED) {
    return "unknown";
  }
  if (storageManager === null) {
    return "unsupported";
  }
  return readPersisted(storageManager);
}

export async function requestStoragePersistence(
  environment?: BrowserDataSafetyEnvironment,
): Promise<StoragePersistenceStatus> {
  const storageManager = navigatorStorage(environment);
  if (storageManager === STORAGE_MANAGER_ACCESS_FAILED) {
    return "unknown";
  }
  if (storageManager === null) {
    return "unsupported";
  }

  let persisted: PersistenceStorageManager["persisted"];
  let persist: PersistenceStorageManager["persist"];
  let capabilityInspectionFailed = false;
  let preflightStatus: StoragePersistenceStatus | null = null;
  try {
    persisted = storageManager.persisted;
  } catch {
    capabilityInspectionFailed = true;
  }
  try {
    persist = storageManager.persist;
  } catch {
    capabilityInspectionFailed = true;
  }

  if (typeof persisted === "function") {
    try {
      preflightStatus = persistenceStatusFromResult(
        await persisted.call(storageManager),
      );
      if (preflightStatus === "persistent") {
        return "persistent";
      }
    } catch {
      preflightStatus = "unknown";
    }
  }

  if (typeof persist !== "function") {
    return (
      preflightStatus ??
      (capabilityInspectionFailed ? "unknown" : "unsupported")
    );
  }

  try {
    return persistenceStatusFromResult(
      await persist.call(storageManager),
    );
  } catch {
    return preflightStatus === "best-effort"
      ? "best-effort"
      : "unknown";
  }
}

function isRfc3339Timestamp(value: string): boolean {
  try {
    rfc3339ToEpochNanoseconds(value);
    return true;
  } catch {
    return false;
  }
}

function readTimestamp(
  storage: DataSafetyMetadataStorage | null,
  key: string,
): string | null {
  if (storage === null) {
    return null;
  }
  try {
    const value = storage.getItem(key);
    return value !== null && isRfc3339Timestamp(value) ? value : null;
  } catch {
    return null;
  }
}

function recordTimestamp(
  timestamp: string,
  key: string,
  environment: BrowserDataSafetyEnvironment | undefined,
): boolean {
  if (!isRfc3339Timestamp(timestamp)) {
    return false;
  }
  const storage = metadataStorage(environment);
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(key, timestamp);
    return true;
  } catch {
    return false;
  }
}

export function readDataSafetyMetadata(
  environment?: BrowserDataSafetyEnvironment,
): DataSafetyMetadata {
  const storage = metadataStorage(environment);
  return {
    lastBackupGeneratedAt: readTimestamp(
      storage,
      LAST_BACKUP_GENERATED_AT_STORAGE_KEY,
    ),
    lastSuccessfulRestoreAt: readTimestamp(
      storage,
      LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY,
    ),
  };
}

/** Records that JSON contents were generated locally, not that a file was saved. */
export function recordBackupGeneratedAt(
  timestamp: string,
  environment?: BrowserDataSafetyEnvironment,
): boolean {
  return recordTimestamp(
    timestamp,
    LAST_BACKUP_GENERATED_AT_STORAGE_KEY,
    environment,
  );
}

export function recordSuccessfulRestoreAt(
  timestamp: string,
  environment?: BrowserDataSafetyEnvironment,
): boolean {
  return recordTimestamp(
    timestamp,
    LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY,
    environment,
  );
}
