import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../db/index.ts';
import { D1PortfolioStore, CloudPortfolioStoreConflictError } from '../application/cloud/server/d1-portfolio-store.ts';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0000_lame_raza.sql', import.meta.url), 'utf8'));
  const adapter: D1DatabaseLike = {
    prepare(query) {
      let values: (string | number | null)[] = [];
      const statement: D1PreparedStatementLike = {
        bind(...args) { values = args as typeof values; return statement; },
        async first<T>() { return (sql.prepare(query).get(...values) ?? null) as T | null; },
        async run() { const result = sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
  return { sql, store: new D1PortfolioStore(adapter) };
}
const instrument = { symbol: 'AAPL', listingMarket: 'NASDAQ', currency: 'USD' } as const;
const mutation = (cost: string, revision: number | null) => ({ action: 'REPLACE_BATCH' as const, batch: { instrument, displayName: 'Synthetic Apple', inputs: [{ id: 'synthetic-input', instrument, quantity: '0.125', costInput: { mode: 'TOTAL_OPEN_COST' as const, value: cost } }] }, options: { expectedRevision: revision } });

describe('applied D1 migration and concurrent current writes', () => {
  it('reads existing schema data without DDL, preserves users and CAS under concurrent writes', async () => {
    const { sql, store } = database();
    try {
      await store.mutate('synthetic-owner-a', mutation('12.50', null));
      await store.mutate('synthetic-owner-b', mutation('23.75', null));
      const beforeB = sql.prepare('SELECT * FROM user_portfolios WHERE user_id = ?').get('synthetic-owner-b');
      const results = await Promise.allSettled([
        store.mutate('synthetic-owner-a', mutation('13.25', 1)),
        store.mutate('synthetic-owner-a', mutation('14.75', 1)),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(r => r.status === 'rejected');
      expect(rejected && rejected.status === 'rejected' && rejected.reason).toBeInstanceOf(CloudPortfolioStoreConflictError);
      expect((await store.load('synthetic-owner-a')).stateRevision).toBe(2);
      expect(sql.prepare('SELECT * FROM user_portfolios WHERE user_id = ?').get('synthetic-owner-b')).toEqual(beforeB);
      const beforeInvalid = sql.prepare('SELECT * FROM user_portfolios').all();
      await expect(store.mutate('synthetic-owner-a', mutation('999', 1))).rejects.toThrow();
      expect(sql.prepare('SELECT * FROM user_portfolios').all()).toEqual(beforeInvalid);
      expect((await store.load('synthetic-empty-owner')).exists).toBe(false);
      expect(sql.prepare('SELECT COUNT(*) AS n FROM user_portfolios').get()).toMatchObject({ n: 2 });
    } finally { sql.close(); }
  });
});
