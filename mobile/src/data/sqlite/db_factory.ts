import { SqliteDatabase } from './sqlite_database.js';
import { ExpoSqliteDatabase } from './expo_sqlite_database.js';

declare const require: any;

/**
 * Initializes and connects to the SQLite content pack database.
 * Supports:
 *  1. Physical mobile device / Expo native runtime via expo-sqlite
 *  2. Node.js test, headless, and CLI runtimes via NodeSqliteDatabase (node:sqlite)
 */
export async function openContentPackDatabase(): Promise<SqliteDatabase> {
  // 1. Attempt Expo native runtime (expo-sqlite)
  try {
    // @ts-ignore dynamic import for native runtime
    const SQLite = await import('expo-sqlite');
    if (SQLite) {
      if (typeof SQLite.openDatabaseAsync === 'function') {
        const assetId = typeof require !== 'undefined' ? require('../../../assets/content_pack.db') : undefined;
        const nativeDb = await SQLite.openDatabaseAsync('content_pack.db', assetId ? { assetSource: { assetId } } : {});
        return new ExpoSqliteDatabase(nativeDb);
      }
      if (typeof SQLite.openDatabaseSync === 'function') {
        const nativeDb = SQLite.openDatabaseSync('content_pack.db');
        return new ExpoSqliteDatabase(nativeDb);
      }
    }
  } catch {
    // expo-sqlite not available in this environment
  }

  // 2. Attempt Node.js runtime (NodeSqliteDatabase)
  try {
    const { NodeSqliteDatabase } = await import('./sqlite_database.js');
    if (NodeSqliteDatabase) {
      let dbPath = './assets/content_pack.db';
      try {
        const proc = (globalThis as any).process;
        // @ts-ignore dynamic import for node filesystem check
        const fs = await import('node:fs');
        // @ts-ignore dynamic import for node path resolution
        const path = await import('node:path');
        const cwd = proc?.cwd?.() || '.';
        const candidates = [
          path.resolve(cwd, 'assets/content_pack.db'),
          path.resolve(cwd, 'mobile/assets/content_pack.db'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            dbPath = candidate;
            break;
          }
        }
      } catch {
        // Fall back to default relative path
      }
      return new NodeSqliteDatabase(dbPath);
    }
  } catch {
    // NodeSqliteDatabase not available in this environment
  }

  throw new Error('No supported SQLite database driver found for this environment.');
}
