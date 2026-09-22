export interface D1RunResultLike {
  readonly meta?: {
    readonly changes?: number;
  };
}

export interface D1PreparedStatementLike {
  bind(...values: readonly unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1RunResultLike[]>;
}
