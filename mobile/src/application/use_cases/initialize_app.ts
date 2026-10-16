import { SqliteDatabase } from '../../data/sqlite/sqlite_database.js';
import { INITIAL_SCHEMA_SQL, CURRENT_SCHEMA_VERSION } from '../../data/sqlite/schema.js';
import { ContentPackImporter } from '../../data/content_pack/content_pack_importer.js';
import { LocalLlmPort, ModelRuntimeStatus } from '../ports/local_llm_port.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface InitializeAppOptions {
  db: SqliteDatabase;
  contentPackImporter?: ContentPackImporter;
  llmPort?: LocalLlmPort;
  logger?: DiagnosticsLogger;
}

export interface AppInitResult {
  isReady: boolean;
  contentPackVersion: string | null;
  schemaVersion: number;
  modelStatus: ModelRuntimeStatus;
  activeTopicCount: number;
  error?: string | null;
}

export class InitializeApp {
  private db: SqliteDatabase;
  private contentPackImporter: ContentPackImporter;
  private llmPort?: LocalLlmPort;
  private logger: DiagnosticsLogger;

  constructor(options: InitializeAppOptions) {
    this.db = options.db;
    this.contentPackImporter = options.contentPackImporter ?? new ContentPackImporter(this.db);
    this.llmPort = options.llmPort;
    this.logger = options.logger ?? DiagnosticsLogger.getInstance();
  }

  public async execute(): Promise<AppInitResult> {
    try {
      // 1. Run migrations / create baseline schema
      await this.runMigrations();

      // 2. Inspect active content pack
      const packMeta = await this.contentPackImporter.getActivePackMetadata();
      const contentPackVersion = packMeta?.version ?? null;

      // 3. Count available topics
      const topicCountRow = await this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM topics'
      );
      const activeTopicCount = topicCountRow?.count ?? 0;

      // 4. Inspect model status (decoupled; model failure does not block quiz initialization)
      let modelStatus: ModelRuntimeStatus = {
        state: 'missing',
      };

      if (this.llmPort) {
        try {
          modelStatus = await this.llmPort.getStatus();
        } catch (err: any) {
          this.logger.warn(
            'init',
            `Model readiness check warning: ${err?.message}`,
            ErrorCodes.MODEL_NOT_FOUND
          );
        }
      }

      this.logger.info('init', 'App initialization complete', {
        contentPackVersion,
        activeTopicCount,
        modelState: modelStatus.state,
      });

      return {
        isReady: true,
        contentPackVersion,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        modelStatus,
        activeTopicCount,
        error: null,
      };
    } catch (err: any) {
      this.logger.error('init', `App initialization fatal error: ${err?.message}`, ErrorCodes.DB_MIGRATION_FAILED);
      return {
        isReady: false,
        contentPackVersion: null,
        schemaVersion: 0,
        modelStatus: { state: 'missing' },
        activeTopicCount: 0,
        error: err?.message,
      };
    }
  }

  private async runMigrations(): Promise<void> {
    // Execute DDL
    await this.db.execute(INITIAL_SCHEMA_SQL);

    // Record migration version if not recorded
    const migration = await this.db.queryOne<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [CURRENT_SCHEMA_VERSION]
    );

    if (!migration) {
      await this.db.execute(
        'INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)',
        [CURRENT_SCHEMA_VERSION, new Date().toISOString(), 'v1-initial-schema']
      );
    }
  }
}

