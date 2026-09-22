import { describe, expect, it, vi } from "vitest";

import {
  LAST_BACKUP_GENERATED_AT_STORAGE_KEY,
  LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY,
  readDataSafetyMetadata,
  readStoragePersistenceStatus,
  recordBackupGeneratedAt,
  recordSuccessfulRestoreAt,
  requestStoragePersistence,
  type BrowserDataSafetyEnvironment,
} from "../application/positions/browser/data-safety.ts";

function metadataEnvironment(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  return {
    environment: { localStorage } satisfies BrowserDataSafetyEnvironment,
    localStorage,
    values,
  };
}

describe("browser storage persistence", () => {
  it("reports unsupported when the Storage API is unavailable", async () => {
    await expect(
      readStoragePersistenceStatus({ navigatorStorage: null }),
    ).resolves.toBe("unsupported");
    await expect(
      requestStoragePersistence({ navigatorStorage: {} }),
    ).resolves.toBe("unsupported");
  });

  it("distinguishes persistent and best-effort storage", async () => {
    await expect(
      readStoragePersistenceStatus({
        navigatorStorage: { persisted: async () => true },
      }),
    ).resolves.toBe("persistent");
    await expect(
      readStoragePersistenceStatus({
        navigatorStorage: { persisted: async () => false },
      }),
    ).resolves.toBe("best-effort");
  });

  it("does not treat non-boolean persistence results as a denial", async () => {
    await expect(
      readStoragePersistenceStatus({
        navigatorStorage: { persisted: async () => undefined },
      }),
    ).resolves.toBe("unknown");
    await expect(
      requestStoragePersistence({
        navigatorStorage: { persist: async () => undefined },
      }),
    ).resolves.toBe("unknown");
    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => false,
          persist: async () => undefined,
        },
      }),
    ).resolves.toBe("unknown");
  });

  it("does not request again when storage is already persistent", async () => {
    const persist = vi.fn(async () => false);

    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => true,
          persist,
        },
      }),
    ).resolves.toBe("persistent");
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports the result of a persistence request", async () => {
    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => false,
          persist: async () => true,
        },
      }),
    ).resolves.toBe("persistent");
    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => false,
          persist: async () => false,
        },
      }),
    ).resolves.toBe("best-effort");
  });

  it("reports unknown when the persistence state cannot be verified", async () => {
    await expect(
      readStoragePersistenceStatus({
        navigatorStorage: {
          persisted: async () => {
            throw new DOMException("blocked", "SecurityError");
          },
        },
      }),
    ).resolves.toBe("unknown");
    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => {
            throw new DOMException("blocked", "SecurityError");
          },
          persist: async () => {
            throw new DOMException("blocked", "SecurityError");
          },
        },
      }),
    ).resolves.toBe("unknown");
  });

  it("reports unknown when persistence capability inspection fails", async () => {
    const navigatorStorage = Object.defineProperty({}, "persisted", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    await expect(
      readStoragePersistenceStatus({ navigatorStorage }),
    ).resolves.toBe("unknown");
    await expect(
      requestStoragePersistence({ navigatorStorage }),
    ).resolves.toBe("unknown");
  });

  it("reports unknown when the storage-manager getter itself is blocked", async () => {
    const environment = Object.defineProperty({}, "navigatorStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }) as BrowserDataSafetyEnvironment;

    await expect(readStoragePersistenceStatus(environment)).resolves.toBe(
      "unknown",
    );
    await expect(requestStoragePersistence(environment)).resolves.toBe(
      "unknown",
    );
  });

  it("retains an explicit best-effort result when only the request fails", async () => {
    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => false,
          persist: async () => {
            throw new DOMException("blocked", "SecurityError");
          },
        },
      }),
    ).resolves.toBe("best-effort");

    await expect(
      requestStoragePersistence({
        navigatorStorage: {
          persisted: async () => {
            throw new DOMException("blocked", "SecurityError");
          },
          persist: async () => false,
        },
      }),
    ).resolves.toBe("best-effort");
  });

  it("can detect existing persistence without request support", async () => {
    await expect(
      requestStoragePersistence({
        navigatorStorage: { persisted: async () => true },
      }),
    ).resolves.toBe("persistent");
  });
});

describe("local data-safety metadata", () => {
  it("round-trips JSON generation and successful restore timestamps", () => {
    const env = metadataEnvironment();

    expect(
      recordBackupGeneratedAt(
        "2026-08-09T10:11:12.123Z",
        env.environment,
      ),
    ).toBe(true);
    expect(
      recordSuccessfulRestoreAt(
        "2026-08-09T18:11:12+08:00",
        env.environment,
      ),
    ).toBe(true);
    expect(readDataSafetyMetadata(env.environment)).toEqual({
      lastBackupGeneratedAt: "2026-08-09T10:11:12.123Z",
      lastSuccessfulRestoreAt: "2026-08-09T18:11:12+08:00",
    });
  });

  it("ignores malformed and impossible RFC 3339 values independently", () => {
    const env = metadataEnvironment({
      [LAST_BACKUP_GENERATED_AT_STORAGE_KEY]: "2026-02-30T10:00:00Z",
      [LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY]:
        "2026-08-09T10:11:12",
    });

    expect(readDataSafetyMetadata(env.environment)).toEqual({
      lastBackupGeneratedAt: null,
      lastSuccessfulRestoreAt: null,
    });

    env.values.set(
      LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY,
      "2026-08-09T10:11:12.123456789Z",
    );
    expect(readDataSafetyMetadata(env.environment)).toEqual({
      lastBackupGeneratedAt: null,
      lastSuccessfulRestoreAt: "2026-08-09T10:11:12.123456789Z",
    });
  });

  it("rejects an invalid write without replacing existing metadata", () => {
    const env = metadataEnvironment({
      [LAST_BACKUP_GENERATED_AT_STORAGE_KEY]: "2026-08-09T10:00:00Z",
    });
    const setItem = vi.spyOn(env.localStorage, "setItem");

    expect(
      recordBackupGeneratedAt("2026-08-09 10:00:00Z", env.environment),
    ).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(readDataSafetyMetadata(env.environment).lastBackupGeneratedAt).toBe(
      "2026-08-09T10:00:00Z",
    );
  });

  it("turns localStorage read and write failures into empty metadata or false", () => {
    const environment: BrowserDataSafetyEnvironment = {
      localStorage: {
        getItem() {
          throw new DOMException("blocked", "SecurityError");
        },
        setItem() {
          throw new DOMException("blocked", "QuotaExceededError");
        },
      },
    };

    expect(readDataSafetyMetadata(environment)).toEqual({
      lastBackupGeneratedAt: null,
      lastSuccessfulRestoreAt: null,
    });
    expect(
      recordSuccessfulRestoreAt("2026-08-09T10:00:00Z", environment),
    ).toBe(false);
  });

  it("is safe when localStorage is unavailable", () => {
    const environment: BrowserDataSafetyEnvironment = {
      localStorage: null,
    };

    expect(readDataSafetyMetadata(environment)).toEqual({
      lastBackupGeneratedAt: null,
      lastSuccessfulRestoreAt: null,
    });
    expect(
      recordBackupGeneratedAt("2026-08-09T10:00:00Z", environment),
    ).toBe(false);
  });
});
