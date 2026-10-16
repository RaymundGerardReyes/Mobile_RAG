import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpoSqliteDatabase, ExpoSqliteLike } from '../../src/data/sqlite/expo_sqlite_database.js';

describe('ExpoSqliteDatabase Adapter', () => {
  class MockExpoSqlite implements ExpoSqliteLike {
    public executedSql: string[] = [];
    public queries: { sql: string; params?: unknown[] }[] = [];
    public isClosed = false;

    public async execAsync(sql: string): Promise<void> {
      this.executedSql.push(sql);
    }

    public async runAsync(sql: string, ...params: any[]): Promise<{ lastInsertRowId?: number; changes?: number }> {
      this.queries.push({ sql, params });
      return { lastInsertRowId: 1, changes: 1 };
    }

    public async getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]> {
      this.queries.push({ sql, params });
      return [{ id: 'q1', score: 1.0 }] as unknown as T[];
    }

    public async getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null> {
      this.queries.push({ sql, params });
      return { id: 'q1', score: 1.0 } as unknown as T;
    }

    public async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
      return await task();
    }

    public async closeAsync(): Promise<void> {
      this.isClosed = true;
    }
  }

  it('delegates execute without params to execAsync', async () => {
    const mock = new MockExpoSqlite();
    const adapter = new ExpoSqliteDatabase(mock);

    await adapter.execute('PRAGMA foreign_keys = ON;');
    assert.deepEqual(mock.executedSql, ['PRAGMA foreign_keys = ON;']);
  });

  it('delegates execute with params to runAsync', async () => {
    const mock = new MockExpoSqlite();
    const adapter = new ExpoSqliteDatabase(mock);

    await adapter.execute('INSERT INTO test (name) VALUES (?);', ['TestName']);
    assert.equal(mock.queries.length, 1);
    assert.equal(mock.queries[0].sql, 'INSERT INTO test (name) VALUES (?);');
    assert.deepEqual(mock.queries[0].params, ['TestName']);
  });

  it('delegates query to getAllAsync and queryOne to getFirstAsync', async () => {
    const mock = new MockExpoSqlite();
    const adapter = new ExpoSqliteDatabase(mock);

    const rows = await adapter.query<{ id: string }>('SELECT * FROM questions;');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'q1');

    const first = await adapter.queryOne<{ id: string }>('SELECT * FROM questions LIMIT 1;');
    assert.equal(first?.id, 'q1');
  });

  it('wraps actions inside withTransactionAsync', async () => {
    const mock = new MockExpoSqlite();
    const adapter = new ExpoSqliteDatabase(mock);

    const result = await adapter.transaction(async (tx) => {
      await tx.execute('DELETE FROM questions;');
      return 'transaction_complete';
    });

    assert.equal(result, 'transaction_complete');
    assert.deepEqual(mock.executedSql, ['DELETE FROM questions;']);
  });

  it('closes cleanly and throws when operations are attempted on closed database', async () => {
    const mock = new MockExpoSqlite();
    const adapter = new ExpoSqliteDatabase(mock);

    await adapter.close();
    assert.equal(mock.isClosed, true);

    await assert.rejects(async () => {
      await adapter.execute('SELECT 1;');
    }, /Database is closed/);
  });
});

