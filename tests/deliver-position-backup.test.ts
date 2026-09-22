// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deliverPositionBackup,
  type PositionBackupDeliveryEnvironment,
} from "../application/positions/browser/deliver-position-backup.ts";
import type { PositionBackupFile } from "../application/positions/position-backup.ts";

const backupFile: PositionBackupFile = {
  fileName: "stock-portfolio-backup-2026-07-30T06-00-00Z.json",
  mediaType: "application/json",
  contents: '{"snapshots":[]}\n',
};

function environment(
  navigator: PositionBackupDeliveryEnvironment["navigator"],
) {
  const revokeObjectURL = vi.fn();
  const createObjectURL = vi.fn(() => "blob:position-backup");
  let scheduledRevoke: (() => void) | undefined;
  const value: PositionBackupDeliveryEnvironment = {
    navigator,
    document,
    url: {
      createObjectURL,
      revokeObjectURL,
    },
    createBlob: (parts, options) => new Blob(parts, options),
    createFile: (parts, fileName, options) =>
      new File(parts, fileName, options),
    scheduleRevoke: (callback) => {
      scheduledRevoke = callback;
    },
  };
  return {
    value,
    createObjectURL,
    revokeObjectURL,
    runScheduledRevoke: () => scheduledRevoke?.(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("position backup delivery", () => {
  it("uses local file sharing when the browser supports it", async () => {
    const share = vi.fn(async (_data?: ShareData) => undefined);
    const env = environment({
      canShare: () => true,
      share,
    });

    await expect(
      deliverPositionBackup(backupFile, env.value),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0]?.files?.[0]).toMatchObject({
      name: backupFile.fileName,
      type: "application/json",
    });
    expect(env.createObjectURL).not.toHaveBeenCalled();
  });

  it("treats a closed share sheet as a cancellation without downloading", async () => {
    const share = vi.fn(async (_data?: ShareData) => {
      throw new DOMException("cancelled", "AbortError");
    });
    const env = environment({
      canShare: () => true,
      share,
    });

    await expect(
      deliverPositionBackup(backupFile, env.value),
    ).resolves.toBe("cancelled");
    expect(env.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to a local Blob download when file sharing fails", async () => {
    const share = vi.fn(async (_data?: ShareData) => {
      throw new DOMException("unsupported", "NotAllowedError");
    });
    const env = environment({
      canShare: () => true,
      share,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      deliverPositionBackup(backupFile, env.value),
    ).resolves.toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(1);
    expect(env.createObjectURL).toHaveBeenCalledTimes(1);
    expect(env.revokeObjectURL).not.toHaveBeenCalled();
    env.runScheduledRevoke();
    expect(env.revokeObjectURL).toHaveBeenCalledWith(
      "blob:position-backup",
    );
  });
});
