import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsLogger, ErrorCodes } from '../../src/diagnostics/diagnostics_logger.js';

describe('Diagnostics: DiagnosticsLogger Ring Buffer & Privacy Redaction', () => {
  it('enforces ring buffer max capacity by evicting oldest entries', () => {
    const logger = new DiagnosticsLogger(10); // capacity 10

    for (let i = 1; i <= 15; i++) {
      logger.info('test', `Message ${i}`);
    }

    const entries = logger.getEntries();
    assert.equal(entries.length, 10);
    assert.equal(entries[0]?.message, 'Message 6'); // First 5 were evicted
    assert.equal(entries[9]?.message, 'Message 15');
  });

  it('redacts sensitive keys in normal logging mode', () => {
    const logger = new DiagnosticsLogger(10);
    logger.warn('llm', 'Generation completed', ErrorCodes.INVALID_MODEL_OUTPUT, {
      prompt: 'CONFIDENTIAL PROMPT TEXT',
      freeTextAnswer: 'STUDENT RESPONSE',
      tokenCount: 42,
    });

    const entries = logger.getEntries();
    assert.equal(entries.length, 1);
    const meta = entries[0]?.metadata as any;
    assert.equal(meta.prompt, '[REDACTED_PRIVACY]');
    assert.equal(meta.freeTextAnswer, '[REDACTED_PRIVACY]');
    assert.equal(meta.tokenCount, 42);
  });

  it('records and retains AI run summary traces', () => {
    const logger = new DiagnosticsLogger(10);
    logger.recordTrace({
      runId: 'trace_01',
      questionId: 'q01',
      contentPackVersion: '2026.10.1',
      retrievalStrategy: 'linked_then_fts5',
      retrievedPassageIds: ['p01', 'p02'],
      modelManifestId: 'qwen-0.5b',
      promptTemplateVersion: 'explain-v1',
      durationMs: 120,
      status: 'completed',
      errorCode: null,
    });

    const traces = logger.getTraces();
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.runId, 'trace_01');
    assert.equal(traces[0]?.status, 'completed');
  });

  it('never throws even if metadata contains circular or problematic structures', () => {
    const logger = new DiagnosticsLogger(10);
    const circularObj: any = {};
    circularObj.self = circularObj;

    assert.doesNotThrow(() => {
      logger.error('crash_test', 'Testing safe error recording', ErrorCodes.LLM_INIT_FAILED, circularObj);
    });
  });

  it('persistTraceToDb inserts trace into ai_run_summaries table safely', async () => {
    const logger = new DiagnosticsLogger(10);
    const mockDb = {
      executed: [] as any[],
      async execute(sql: string, params?: unknown[]) {
        this.executed.push({ sql, params });
      },
    };

    await logger.persistTraceToDb(mockDb, {
      runId: 'trace_sql_01',
      questionId: 'q01',
      contentPackVersion: '2026.10.1',
      retrievalStrategy: 'linked',
      retrievedPassageIds: ['p01'],
      modelManifestId: 'qwen-0.5b',
      promptTemplateVersion: 'explain-v1',
      durationMs: 95,
      status: 'completed',
      errorCode: null,
    });

    assert.equal(mockDb.executed.length, 1);
    assert.ok(mockDb.executed[0].sql.includes('INSERT INTO ai_run_summaries'));
    assert.equal(mockDb.executed[0].params[0], 'trace_sql_01');
  });
});

