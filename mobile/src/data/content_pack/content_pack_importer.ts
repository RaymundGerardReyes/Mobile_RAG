import { SqliteDatabase } from '../sqlite/sqlite_database.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface ContentPackMetadata {
  pack_id: string;
  version: string;
  source_revision: string;
  imported_at: string;
  content_hash: string;
}

export interface ContentPackData {
  metadata: ContentPackMetadata;
  topics: Array<{ id: string; title: string; sort_order: number }>;
  passages: Array<{
    id: string;
    chapter: string;
    section?: string | null;
    start_page: number;
    end_page: number;
    text: string;
    content_hash: string;
  }>;
  questions: Array<{
    id: string;
    topic_id: string;
    question_type: string;
    stem: string;
    canonical_explanation?: string | null;
    source_page: number;
    difficulty?: string | null;
    content_version: string;
  }>;
  choices: Array<{
    id: string;
    question_id: string;
    choice_key: string;
    text: string;
    sort_order: number;
  }>;
  question_answers: Array<{
    question_id: string;
    canonical_choice_id?: string | null;
    canonical_answer?: string | null;
  }>;
  question_passages: Array<{
    question_id: string;
    passage_id: string;
    link_type: string;
    confidence: string;
    reviewer_status: string;
  }>;
}

export class ContentPackImporter {
  private db: SqliteDatabase;
  private logger: DiagnosticsLogger;

  constructor(db: SqliteDatabase, logger?: DiagnosticsLogger) {
    this.db = db;
    this.logger = logger ?? DiagnosticsLogger.getInstance();
  }

  /**
   * Imports a content pack atomically within a single SQLite transaction.
   * Learner tables (`study_sessions` and `answer_attempts`) are strictly preserved.
   */
  public async importPack(pack: ContentPackData): Promise<boolean> {
    this.validatePackData(pack);

    try {
      // Temporarily disable foreign keys during atomic table replacement to protect existing answer_attempts.
      // Must be done outside transaction in SQLite.
      await this.db.execute('PRAGMA foreign_keys = OFF;');

      await this.db.transaction(async (tx) => {
        // Clear existing content tables (NOT user progress tables)
        await tx.execute('DELETE FROM question_passages;');
        await tx.execute('DELETE FROM question_answers;');
        await tx.execute('DELETE FROM choices;');
        await tx.execute('DELETE FROM questions;');
        await tx.execute('DELETE FROM passages;');
        try {
          await tx.execute('DELETE FROM passages_fts;');
        } catch {
          // Virtual table may not yet be created or empty
        }
        await tx.execute('DELETE FROM topics;');
        await tx.execute('DELETE FROM content_pack_metadata;');

        // Insert topics
        for (const t of pack.topics) {
          await tx.execute(
            'INSERT INTO topics (id, title, sort_order) VALUES (?, ?, ?)',
            [t.id, t.title, t.sort_order]
          );
        }

        // Insert passages
        for (const p of pack.passages) {
          await tx.execute(
            'INSERT INTO passages (id, chapter, section, start_page, end_page, text, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [p.id, p.chapter, p.section ?? null, p.start_page, p.end_page, p.text, p.content_hash]
          );
        }

        // Insert questions
        for (const q of pack.questions) {
          await tx.execute(
            'INSERT INTO questions (id, topic_id, question_type, stem, canonical_explanation, source_page, difficulty, content_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              q.id,
              q.topic_id,
              q.question_type,
              q.stem,
              q.canonical_explanation ?? null,
              q.source_page,
              q.difficulty ?? null,
              q.content_version,
            ]
          );
        }

        // Insert choices
        for (const c of pack.choices) {
          await tx.execute(
            'INSERT INTO choices (id, question_id, choice_key, text, sort_order) VALUES (?, ?, ?, ?, ?)',
            [c.id, c.question_id, c.choice_key, c.text, c.sort_order]
          );
        }

        // Insert question_answers
        for (const qa of pack.question_answers) {
          await tx.execute(
            'INSERT INTO question_answers (question_id, canonical_choice_id, canonical_answer) VALUES (?, ?, ?)',
            [qa.question_id, qa.canonical_choice_id ?? null, qa.canonical_answer ?? null]
          );
        }

        // Insert question_passages
        for (const qp of pack.question_passages) {
          await tx.execute(
            'INSERT INTO question_passages (question_id, passage_id, link_type, confidence, reviewer_status) VALUES (?, ?, ?, ?, ?)',
            [qp.question_id, qp.passage_id, qp.link_type, qp.confidence, qp.reviewer_status]
          );
        }

        // Populate FTS5 index
        try {
          await tx.execute(`
            INSERT INTO passages_fts (rowid, passage_id, chapter, section, text)
            SELECT rowid, id, chapter, section, text FROM passages
          `);
        } catch {
          // If FTS virtual table not configured
        }

        // Insert content pack metadata
        const meta = pack.metadata;
        await tx.execute(
          'INSERT INTO content_pack_metadata (pack_id, version, source_revision, imported_at, content_hash) VALUES (?, ?, ?, ?, ?)',
          [meta.pack_id, meta.version, meta.source_revision, meta.imported_at, meta.content_hash]
        );
      });

      this.logger.info(
        'content_pack',
        `Successfully imported content pack ${pack.metadata.pack_id} version ${pack.metadata.version}`
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        'content_pack',
        `Content pack import failed: ${err?.message}`,
        ErrorCodes.CONTENT_PACK_IMPORT_FAILED
      );
      throw err;
    } finally {
      // Always re-enable foreign keys after atomic pack swap
      try {
        await this.db.execute('PRAGMA foreign_keys = ON;');
      } catch {
        // Ignore secondary error on closed DB
      }
    }
  }

  public async getActivePackMetadata(): Promise<ContentPackMetadata | null> {
    try {
      const row = await this.db.queryOne<ContentPackMetadata>(
        'SELECT pack_id, version, source_revision, imported_at, content_hash FROM content_pack_metadata LIMIT 1'
      );
      return row;
    } catch {
      return null;
    }
  }

  private validatePackData(pack: ContentPackData): void {
    if (!pack.metadata || !pack.metadata.pack_id || !pack.metadata.version || !pack.metadata.content_hash) {
      throw new Error('Invalid content pack: missing pack_id, version, or content_hash');
    }
    if (!pack.topics || pack.topics.length === 0) {
      throw new Error('Invalid content pack: no topics provided');
    }
    if (!pack.questions || pack.questions.length === 0) {
      throw new Error('Invalid content pack: no questions provided');
    }

    const topicIds = new Set<string>();
    for (const t of pack.topics) {
      if (!t.id) throw new Error('Invalid content pack: topic missing ID');
      if (topicIds.has(t.id)) throw new Error(`Invalid content pack: duplicate topic ID ${t.id}`);
      topicIds.add(t.id);
    }

    const questionIds = new Set<string>();
    for (const q of pack.questions) {
      if (!q.id) throw new Error('Invalid content pack: question missing ID');
      if (questionIds.has(q.id)) throw new Error(`Invalid content pack: duplicate question ID ${q.id}`);
      if (!topicIds.has(q.topic_id)) {
        throw new Error(`Invalid content pack: question ${q.id} references non-existent topic ${q.topic_id}`);
      }
      questionIds.add(q.id);
    }

    const passageIds = new Set<string>();
    if (pack.passages) {
      for (const p of pack.passages) {
        if (!p.id) throw new Error('Invalid content pack: passage missing ID');
        if (passageIds.has(p.id)) throw new Error(`Invalid content pack: duplicate passage ID ${p.id}`);
        passageIds.add(p.id);
      }
    }

    const choiceIds = new Set<string>();
    if (pack.choices) {
      for (const c of pack.choices) {
        if (!c.id) throw new Error('Invalid content pack: choice missing ID');
        if (choiceIds.has(c.id)) throw new Error(`Invalid content pack: duplicate choice ID ${c.id}`);
        if (!questionIds.has(c.question_id)) {
          throw new Error(`Invalid content pack: choice ${c.id} references non-existent question ${c.question_id}`);
        }
        choiceIds.add(c.id);
      }
    }

    if (pack.question_answers) {
      for (const qa of pack.question_answers) {
        if (!questionIds.has(qa.question_id)) {
          throw new Error(`Invalid content pack: answer key references non-existent question ${qa.question_id}`);
        }
        if (qa.canonical_choice_id && !choiceIds.has(qa.canonical_choice_id)) {
          throw new Error(
            `Invalid content pack: answer key for ${qa.question_id} references non-existent canonical choice ${qa.canonical_choice_id}`
          );
        }
      }
    }

    if (pack.question_passages) {
      for (const qp of pack.question_passages) {
        if (!questionIds.has(qp.question_id)) {
          throw new Error(`Invalid content pack: passage link references non-existent question ${qp.question_id}`);
        }
        if (!passageIds.has(qp.passage_id)) {
          throw new Error(`Invalid content pack: passage link references non-existent passage ${qp.passage_id}`);
        }
      }
    }
  }
}
