import { DatabaseSync } from 'node:sqlite';

export interface SqliteDatabase {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(action: (db: SqliteDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Concrete SQLite driver for Node.js (Node 22+ node:sqlite or testing).
 * Supports standard SQL statements, parameterized queries, transactions, and FTS5.
 */
export class NodeSqliteDatabase implements SqliteDatabase {
  private db: DatabaseSync | null;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
  }

  public async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.db) throw new Error('Database is closed');
    if (params.length === 0) {
      this.db.exec(sql);
    } else {
      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    }
  }

  public async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database is closed');
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows as T[];
  }

  public async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? (rows[0] as T) : null;
  }

  public async transaction<T>(action: (db: SqliteDatabase) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database is closed');
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = await action(this);
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Rollback failure secondary error
      }
      throw err;
    }
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

