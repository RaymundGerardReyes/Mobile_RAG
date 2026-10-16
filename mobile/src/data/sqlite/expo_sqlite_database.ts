import { SqliteDatabase } from './sqlite_database.js';

/**
 * Structural contract matching modern async expo-sqlite (v14+ / SDK 51+).
 * Decouples the domain/application layer from the native Expo runtime package.
 */
export interface ExpoSqliteLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: any[]): Promise<{ lastInsertRowId?: number; changes?: number }>;
  getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null>;
  withTransactionAsync<T>(task: () => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}

/**
 * Concrete SQLite adapter for physical iPhone / Expo Go / Prebuild runtimes.
 * Conforms to the pure application port `SqliteDatabase`.
 */
export class ExpoSqliteDatabase implements SqliteDatabase {
  private nativeDb: ExpoSqliteLike | null;

  constructor(nativeDb: ExpoSqliteLike) {
    this.nativeDb = nativeDb;
  }

  public async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.nativeDb) throw new Error('Database is closed');
    if (params.length === 0) {
      await this.nativeDb.execAsync(sql);
    } else {
      await this.nativeDb.runAsync(sql, ...params);
    }
  }

  public async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.nativeDb) throw new Error('Database is closed');
    const rows = await this.nativeDb.getAllAsync<T>(sql, ...params);
    return rows;
  }

  public async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.nativeDb) throw new Error('Database is closed');
    const row = await this.nativeDb.getFirstAsync<T>(sql, ...params);
    return row ?? null;
  }

  public async transaction<T>(action: (db: SqliteDatabase) => Promise<T>): Promise<T> {
    if (!this.nativeDb) throw new Error('Database is closed');
    return await this.nativeDb.withTransactionAsync(() => action(this));
  }

  public async close(): Promise<void> {
    if (this.nativeDb) {
      await this.nativeDb.closeAsync();
      this.nativeDb = null;
    }
  }
}
