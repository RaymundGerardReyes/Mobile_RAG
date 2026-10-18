import {
  QuestionRepository,
  QuestionSelectionQuery,
  TopicSummary,
} from '../../application/ports/question_repository.js';
import { AnswerAttempt, Choice, Difficulty, Question, QuestionType, Topic } from '../../domain/types.js';
import { SqliteDatabase } from './sqlite_database.js';

interface QuestionRow {
  id: string;
  topic_id: string;
  question_type: string;
  stem: string;
  canonical_explanation: string | null;
  source_page: number;
  difficulty: string | null;
  content_version: string;
  canonical_choice_id: string | null;
  canonical_answer: string | null;
}

interface ChoiceRow {
  id: string;
  question_id: string;
  choice_key: string;
  text: string;
  sort_order: number;
}

export class SqliteQuestionRepository implements QuestionRepository {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public async getQuestionById(id: string): Promise<Question | null> {
    const row = await this.db.queryOne<QuestionRow>(
      `SELECT q.id, q.topic_id, q.question_type, q.stem, q.canonical_explanation,
              q.source_page, q.difficulty, q.content_version,
              qa.canonical_choice_id, qa.canonical_answer
       FROM questions q
       LEFT JOIN question_answers qa ON q.id = qa.question_id
       WHERE q.id = ?`,
      [id]
    );

    if (!row) return null;

    const choices = await this.getChoicesForQuestion(id);
    return this.mapToQuestion(row, choices);
  }

  public async getNextQuestions(query: QuestionSelectionQuery): Promise<Question[]> {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (query.topicId) {
      whereClauses.push('q.topic_id = ?');
      params.push(query.topicId);
    }

    if (query.excludeQuestionIds && query.excludeQuestionIds.length > 0) {
      const placeholders = query.excludeQuestionIds.map(() => '?').join(',');
      whereClauses.push(`q.id NOT IN (${placeholders})`);
      params.push(...query.excludeQuestionIds);
    }

    if (query.mode === 'unanswered') {
      whereClauses.push('q.id NOT IN (SELECT DISTINCT question_id FROM answer_attempts)');
    }

    let orderBy = 'ORDER BY q.id ASC';
    if (query.mode === 'weak_areas') {
      // Prioritize questions where user failed, or unanswered
      orderBy = `ORDER BY (
        SELECT COUNT(*) FROM answer_attempts a WHERE a.question_id = q.id AND a.is_correct = 0
      ) DESC, q.id ASC`;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = query.limit ?? 10;
    params.push(limit);

    const sql = `
      SELECT q.id, q.topic_id, q.question_type, q.stem, q.canonical_explanation,
             q.source_page, q.difficulty, q.content_version,
             qa.canonical_choice_id, qa.canonical_answer
      FROM questions q
      LEFT JOIN question_answers qa ON q.id = qa.question_id
      ${whereSql}
      ${orderBy}
      LIMIT ?
    `;

    const rows = await this.db.query<QuestionRow>(sql, params);
    if (rows.length === 0) return [];

    const questionIds = rows.map((r) => r.id);
    const choicesByQuestion = await this.getChoicesForQuestions(questionIds);

    return rows.map((r) => this.mapToQuestion(r, choicesByQuestion.get(r.id) || []));
  }

  public async recordAttempt(attempt: AnswerAttempt): Promise<void> {
    await this.db.execute(
      `INSERT INTO answer_attempts (
        id, session_id, question_id, selected_choice_id,
        free_text_answer, is_correct, score, duration_ms, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.id,
        attempt.sessionId ?? null,
        attempt.questionId,
        attempt.selectedChoiceId ?? null,
        attempt.freeTextAnswer ?? null,
        attempt.isCorrect ? 1 : 0,
        attempt.score ?? (attempt.isCorrect ? 1.0 : 0.0),
        attempt.durationMs,
        attempt.answeredAt,
      ]
    );
  }

  public async getTopicSummaries(): Promise<TopicSummary[]> {
    interface TopicSummaryRow {
      id: string;
      title: string;
      sortOrder: number;
      total: number;
      answered: number;
      correct: number;
    }

    const rows = await this.db.query<TopicSummaryRow>(
      `SELECT
        t.id,
        t.title,
        t.sort_order as sortOrder,
        COUNT(DISTINCT q.id) as total,
        COUNT(DISTINCT a.question_id) as answered,
        COUNT(DISTINCT CASE WHEN a.is_correct = 1 THEN a.question_id END) as correct
       FROM topics t
       LEFT JOIN questions q ON t.id = q.topic_id
       LEFT JOIN answer_attempts a ON q.id = a.question_id
       GROUP BY t.id, t.title, t.sort_order
       ORDER BY t.sort_order ASC`
    );

    return rows.map((r) => ({
      topic: {
        id: r.id,
        title: r.title,
        sortOrder: r.sortOrder,
      },
      totalQuestions: r.total ?? 0,
      answeredCount: r.answered ?? 0,
      correctCount: r.correct ?? 0,
    }));
  }

  private async getChoicesForQuestion(questionId: string): Promise<Choice[]> {
    const rows = await this.db.query<ChoiceRow>(
      'SELECT id, question_id, choice_key, text, sort_order FROM choices WHERE question_id = ? ORDER BY sort_order ASC',
      [questionId]
    );
    return rows.map((r) => ({
      id: r.id,
      questionId: r.question_id,
      choiceKey: r.choice_key,
      text: r.text,
      sortOrder: r.sort_order,
    }));
  }

  private async getChoicesForQuestions(questionIds: string[]): Promise<Map<string, Choice[]>> {
    if (questionIds.length === 0) return new Map();
    const placeholders = questionIds.map(() => '?').join(',');
    const rows = await this.db.query<ChoiceRow>(
      `SELECT id, question_id, choice_key, text, sort_order
       FROM choices
       WHERE question_id IN (${placeholders})
       ORDER BY sort_order ASC`,
      questionIds
    );

    const map = new Map<string, Choice[]>();
    for (const r of rows) {
      const list = map.get(r.question_id) || [];
      list.push({
        id: r.id,
        questionId: r.question_id,
        choiceKey: r.choice_key,
        text: r.text,
        sortOrder: r.sort_order,
      });
      map.set(r.question_id, list);
    }
    return map;
  }

  private mapToQuestion(row: QuestionRow, choices: Choice[]): Question {
    return {
      id: row.id,
      topicId: row.topic_id,
      questionType: row.question_type as QuestionType,
      stem: row.stem,
      canonicalExplanation: row.canonical_explanation,
      sourcePage: row.source_page,
      difficulty: (row.difficulty as Difficulty) ?? null,
      contentVersion: row.content_version,
      choices,
      canonicalChoiceId: row.canonical_choice_id,
      canonicalAnswer: row.canonical_answer,
    };
  }
}
