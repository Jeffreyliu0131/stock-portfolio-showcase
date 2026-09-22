import type { D1DatabaseLike } from "../../../db/index.ts";
import {
  applyCloudPortfolioMutation,
  createCloudPortfolioState,
  emptyCloudPortfolioState,
  type CloudPortfolioMutation,
  type CloudPortfolioMutationResult,
  type CloudPortfolioState,
} from "../portfolio-state.ts";

const MAX_STATE_BYTES = 1_048_576;

interface PortfolioRow {
  readonly state_json: string;
  readonly state_version: number;
}

export interface LoadedCloudPortfolio {
  readonly state: CloudPortfolioState;
  readonly stateRevision: number;
  readonly exists: boolean;
}

export interface MutatedCloudPortfolio extends CloudPortfolioMutationResult {
  readonly stateRevision: number;
}

export class CloudPortfolioStoreConflictError extends Error {
  constructor() {
    super("cloud portfolio changed during this request");
    this.name = "CloudPortfolioStoreConflictError";
  }
}

function validUserId(value: string): string {
  if (value.length < 1 || value.length > 256 || value.trim() !== value) {
    throw new Error("authenticated user id is invalid");
  }
  return value;
}

function parseStateJson(value: string): CloudPortfolioState {
  if (new TextEncoder().encode(value).byteLength > MAX_STATE_BYTES) {
    throw new Error("stored cloud portfolio exceeds the supported size");
  }
  return createCloudPortfolioState(JSON.parse(value) as unknown);
}

function serializeState(value: CloudPortfolioState): string {
  const json = JSON.stringify(createCloudPortfolioState(value));
  if (new TextEncoder().encode(json).byteLength > MAX_STATE_BYTES) {
    throw new Error("cloud portfolio exceeds the supported size");
  }
  return json;
}

function changedRows(result: { readonly meta?: { readonly changes?: number } }): number {
  return result.meta?.changes ?? 0;
}

export class D1PortfolioStore {
  readonly #database: D1DatabaseLike;

  constructor(database: D1DatabaseLike) {
    this.#database = database;
  }

  async load(userIdInput: string): Promise<LoadedCloudPortfolio> {
    const userId = validUserId(userIdInput);
    const row = await this.#database
      .prepare(
        "SELECT state_json, state_version FROM user_portfolios WHERE user_id = ? LIMIT 1",
      )
      .bind(userId)
      .first<PortfolioRow>();
    if (row === null) {
      return {
        state: emptyCloudPortfolioState(),
        stateRevision: 0,
        exists: false,
      };
    }
    if (
      typeof row.state_json !== "string" ||
      !Number.isSafeInteger(row.state_version) ||
      row.state_version < 1
    ) {
      throw new Error("stored cloud portfolio row is invalid");
    }
    return {
      state: parseStateJson(row.state_json),
      stateRevision: row.state_version,
      exists: true,
    };
  }

  async mutate(
    userIdInput: string,
    mutation: CloudPortfolioMutation,
    now = new Date().toISOString(),
  ): Promise<MutatedCloudPortfolio> {
    const userId = validUserId(userIdInput);
    const loaded = await this.load(userId);
    const result = applyCloudPortfolioMutation(loaded.state, mutation, now);
    if (!result.changed) {
      return { ...result, stateRevision: loaded.stateRevision };
    }

    const stateJson = serializeState(result.state);
    if (!loaded.exists) {
      const inserted = await this.#database
        .prepare(
          `INSERT OR IGNORE INTO user_portfolios
           (user_id, state_version, state_json, created_at, updated_at)
           VALUES (?, 1, ?, ?, ?)`,
        )
        .bind(userId, stateJson, now, now)
        .run();
      if (changedRows(inserted) !== 1) {
        throw new CloudPortfolioStoreConflictError();
      }
      return { ...result, stateRevision: 1 };
    }

    const nextStateRevision = loaded.stateRevision + 1;
    if (!Number.isSafeInteger(nextStateRevision)) {
      throw new Error("cloud state revision limit has been reached");
    }
    const updated = await this.#database
      .prepare(
        `UPDATE user_portfolios
         SET state_version = ?, state_json = ?, updated_at = ?
         WHERE user_id = ? AND state_version = ?`,
      )
      .bind(nextStateRevision, stateJson, now, userId, loaded.stateRevision)
      .run();
    if (changedRows(updated) !== 1) {
      throw new CloudPortfolioStoreConflictError();
    }
    return { ...result, stateRevision: nextStateRevision };
  }
}
