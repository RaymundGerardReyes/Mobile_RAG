import { PassageRetriever, RetrievedPassage } from '../../application/ports/passage_retriever.js';
import { Passage } from '../../domain/types.js';
import { SqliteDatabase } from './sqlite_database.js';

interface PassageRow {
  id: string;
  chapter: string;
  section: string | null;
  start_page: number;
  end_page: number;
  text: string;
  content_hash: string;
  link_type?: string;
  confidence?: string;
  rank?: number;
}

export class SqlitePassageRetriever implements PassageRetriever {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public async retrieveForQuestion(
    questionId: string,
    stem: string,
    limit = 3
  ): Promise<RetrievedPassage[]> {
    const results: RetrievedPassage[] = [];
    const seenPassageIds = new Set<string>();

    // Tier 1: Vetted question_passages link
    const linkedSql = `
      SELECT p.id, p.chapter, p.section, p.start_page, p.end_page, p.text, p.content_hash,
             qp.confidence, qp.link_type
      FROM question_passages qp
      JOIN passages p ON qp.passage_id = p.id
      WHERE qp.question_id = ?
      ORDER BY CASE qp.confidence
        WHEN 'verified' THEN 1
        WHEN 'high' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END ASC
      LIMIT ?
    `;

    try {
      const linkedRows = await this.db.query<PassageRow>(linkedSql, [questionId, limit]);
      for (const row of linkedRows) {
        seenPassageIds.add(row.id);
        results.push({
          passage: this.mapRowToPassage(row),
          strategy: 'linked',
          confidence: row.confidence,
        });
      }
    } catch {
      // In case question_passages is empty or table doesn't have links
    }

    // Tier 2: FTS5 BM25 fallback if needed
    const remainingLimit = limit - results.length;
    if (remainingLimit > 0 && stem.trim().length > 0) {
      const ftsResults = await this.searchPassages(stem, remainingLimit, seenPassageIds);
      results.push(...ftsResults);
    }

    return results;
  }

  public async searchPassages(
    query: string,
    limit = 5,
    excludeIds: Set<string> = new Set()
  ): Promise<RetrievedPassage[]> {
    const ftsQuery = this.sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    const sql = `
      SELECT p.id, p.chapter, p.section, p.start_page, p.end_page, p.text, p.content_hash,
             bm25(passages_fts) as rank
      FROM passages_fts
      JOIN passages p ON passages_fts.rowid = p.rowid
      WHERE passages_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `;

    try {
      const rows = await this.db.query<PassageRow>(sql, [ftsQuery, limit + excludeIds.size]);
      const results: RetrievedPassage[] = [];

      for (const row of rows) {
        if (excludeIds.has(row.id)) continue;
        results.push({
          passage: this.mapRowToPassage(row),
          strategy: 'fts5',
          rank: row.rank,
        });
        if (results.length >= limit) break;
      }

      return results;
    } catch {
      // FTS table might be unindexed or query syntax error; gracefully degrade to empty
      return [];
    }
  }

  /**
   * Sanitizes user or stem text into safe, valid FTS5 MATCH syntax.
   * Strips operators and joins keywords with OR.
   */
  private sanitizeFtsQuery(raw: string): string | null {
    if (!raw) return null;
    const tokens = raw
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !this.isStopWord(t.toLowerCase()));

    if (tokens.length === 0) return null;
    // Quote individual terms to prevent syntax errors
    return tokens.map((t) => `"${t}"`).join(' OR ');
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'and', 'what', 'which', 'who', 'where', 'when', 'why', 'how',
      'this', 'that', 'with', 'from', 'have', 'been', 'does', 'were', 'will'
    ]);
    return stopWords.has(word);
  }

  private mapRowToPassage(row: PassageRow): Passage {
    return {
      id: row.id,
      chapter: row.chapter,
      section: row.section,
      startPage: row.start_page,
      endPage: row.end_page,
      text: row.text,
      contentHash: row.content_hash,
    };
  }
}
