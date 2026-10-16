import { DiagnosticsBundle, DiagnosticsLogger } from '../../diagnostics/diagnostics_logger.js';
import { LocalLlmPort } from '../ports/local_llm_port.js';
import { SqliteDatabase } from '../../data/sqlite/sqlite_database.js';

export interface ExportDiagnosticsOptions {
  logger?: DiagnosticsLogger;
  llmPort?: LocalLlmPort;
  db?: SqliteDatabase;
  appVersion?: string;
  buildId?: string;
}

export interface DiagnosticsExportResult {
  bundle: DiagnosticsBundle;
  jsonString: string;
}

export class ExportDiagnostics {
  private logger: DiagnosticsLogger;
  private llmPort?: LocalLlmPort;
  private db?: SqliteDatabase;
  private appVersion: string;
  private buildId: string;

  constructor(options: ExportDiagnosticsOptions = {}) {
    this.logger = options.logger ?? DiagnosticsLogger.getInstance();
    this.llmPort = options.llmPort;
    this.db = options.db;
    this.appVersion = options.appVersion ?? '0.1.0';
    this.buildId = options.buildId ?? 'local-build';
  }

  public async execute(): Promise<DiagnosticsExportResult> {
    // 1. Gather non-sensitive system status before generating export bundle
    if (this.db) {
      try {
        const packRow = await this.db.queryOne<{ version: string; content_hash: string }>(
          'SELECT version, content_hash FROM content_pack_metadata LIMIT 1'
        );
        if (packRow) {
          this.logger.info('diagnostics_export', 'Attached content pack metadata to export', {
            contentPackVersion: packRow.version,
            contentHashPrefix: packRow.content_hash.substring(0, 8),
          });
        }
      } catch {
        // Continue even if DB query fails
      }
    }

    if (this.llmPort) {
      try {
        const modelStatus = await this.llmPort.getStatus();
        this.logger.info('diagnostics_export', 'Attached model status to export', {
          modelState: modelStatus.state,
          manifestId: modelStatus.manifestId,
        });
      } catch {
        // Continue even if LLM status fails
      }
    }

    // 2. Export bundle after attaching metadata
    const bundle = this.logger.exportBundle(this.appVersion, this.buildId);
    const jsonString = JSON.stringify(bundle, null, 2);

    return {
      bundle,
      jsonString,
    };
  }
}

