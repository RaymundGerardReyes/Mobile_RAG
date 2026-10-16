export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const ErrorCodes = {
  DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',
  CONTENT_HASH_MISMATCH: 'CONTENT_HASH_MISMATCH',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_HASH_MISMATCH: 'MODEL_HASH_MISMATCH',
  LLM_INIT_FAILED: 'LLM_INIT_FAILED',
  LLM_OOM: 'LLM_OOM',
  LLM_CANCELLED: 'LLM_CANCELLED',
  RETRIEVAL_EMPTY: 'RETRIEVAL_EMPTY',
  INVALID_MODEL_OUTPUT: 'INVALID_MODEL_OUTPUT',
  CONCURRENT_GENERATION_NOT_ALLOWED: 'CONCURRENT_GENERATION_NOT_ALLOWED',
  CONTENT_PACK_IMPORT_FAILED: 'CONTENT_PACK_IMPORT_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | string;

export interface LogEntry {
  timestamp: string; // ISO 8601
  level: LogLevel;
  category: string;
  message: string;
  errorCode?: ErrorCode | null;
  metadata?: Record<string, unknown>;
}

export interface AiRunSummaryTrace {
  runId: string;
  questionId: string;
  contentPackVersion: string;
  retrievalStrategy: string;
  retrievedPassageIds: string[];
  modelManifestId: string;
  promptTemplateVersion: string;
  durationMs: number;
  status: 'completed' | 'cancelled' | 'failed';
  errorCode: ErrorCode | null;
  emittedTokenCount?: number;
}

export interface DiagnosticsBundle {
  exportedAt: string;
  appVersion: string;
  buildId?: string;
  totalLogEntries: number;
  entries: LogEntry[];
  recentTraces: AiRunSummaryTrace[];
}

export class DiagnosticsLogger {
  private static instance: DiagnosticsLogger | null = null;
  private readonly maxEntries: number;
  private readonly entries: LogEntry[] = [];
  private readonly traces: AiRunSummaryTrace[] = [];

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  public static getInstance(): DiagnosticsLogger {
    if (!DiagnosticsLogger.instance) {
      DiagnosticsLogger.instance = new DiagnosticsLogger();
    }
    return DiagnosticsLogger.instance;
  }

  public log(
    level: LogLevel,
    category: string,
    message: string,
    errorCode?: ErrorCode | null,
    metadata?: Record<string, unknown>
  ): void {
    try {
      const sanitizedMeta = this.sanitizeMetadata(metadata);
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        errorCode: errorCode || null,
        metadata: sanitizedMeta,
      };

      if (this.entries.length >= this.maxEntries) {
        this.entries.shift(); // Evict oldest entry in ring buffer
      }
      this.entries.push(entry);
    } catch {
      // Logging must never throw into user flows
    }
  }

  public debug(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', category, message, undefined, metadata);
  }

  public info(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('info', category, message, undefined, metadata);
  }

  public warn(
    category: string,
    message: string,
    errorCode?: ErrorCode | null,
    metadata?: Record<string, unknown>
  ): void {
    this.log('warn', category, message, errorCode, metadata);
  }

  public error(
    category: string,
    message: string,
    errorCode?: ErrorCode | null,
    metadata?: Record<string, unknown>
  ): void {
    this.log('error', category, message, errorCode, metadata);
  }

  public recordTrace(trace: AiRunSummaryTrace): void {
    try {
      if (this.traces.length >= this.maxEntries) {
        this.traces.shift();
      }
      this.traces.push(trace);
    } catch {
      // Must not throw
    }
  }

  /**
   * Optionally persists an AI run summary trace directly into the SQLite ai_run_summaries table.
   * Never throws into user flows on database write failure.
   */
  public async persistTraceToDb(
    db: { execute: (sql: string, params?: unknown[]) => Promise<void> },
    trace: AiRunSummaryTrace
  ): Promise<void> {
    try {
      await db.execute(
        `INSERT INTO ai_run_summaries (
          id, question_id, model_id, prompt_version,
          status, duration_ms, retrieved_passage_ids_json, output_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trace.runId,
          trace.questionId,
          trace.modelManifestId,
          trace.promptTemplateVersion,
          trace.status,
          trace.durationMs,
          JSON.stringify(trace.retrievedPassageIds),
          null,
        ]
      );
    } catch {
      // Diagnostics must never break main flows
    }
  }

  public getEntries(): ReadonlyArray<LogEntry> {
    return [...this.entries];
  }

  public getTraces(): ReadonlyArray<AiRunSummaryTrace> {
    return [...this.traces];
  }

  public clear(): void {
    this.entries.length = 0;
    this.traces.length = 0;
  }

  public exportBundle(appVersion = '0.1.0', buildId = 'local-dev'): DiagnosticsBundle {
    return {
      exportedAt: new Date().toISOString(),
      appVersion,
      buildId,
      totalLogEntries: this.entries.length,
      entries: [...this.entries],
      recentTraces: [...this.traces],
    };
  }

  /**
   * Redacts sensitive prompt bodies, response bodies, and raw learner input in normal mode.
   */
  private sanitizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!meta) return undefined;
    const sanitized: Record<string, unknown> = {};

    const sensitiveKeys = new Set([
      'prompt',
      'promptBody',
      'response',
      'responseText',
      'freeTextAnswer',
      'userAnswer',
      'rawInput',
    ]);

    for (const [key, value] of Object.entries(meta)) {
      if (sensitiveKeys.has(key)) {
        sanitized[key] = '[REDACTED_PRIVACY]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

