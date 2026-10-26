import { PassageRetriever, RetrievedPassage } from '../../application/ports/passage_retriever.js';
import { Passage } from '../../domain/types.js';
import { SqliteDatabase } from './sqlite_database.js';

export const FTS_STOP_WORDS: Set<string> = new Set([
  // English stop words
  'the', 'is', 'in', 'at', 'of', 'on', 'and', 'a', 'an', 'to', 'for', 'with', 'under',
  'which', 'what', 'who', 'whom', 'how', 'many', 'following', 'all', 'are', 'be', 'by',
  'from', 'have', 'been', 'does', 'were', 'will', 'would', 'should', 'could', 'this',
  'that', 'these', 'those', 'into', 'onto', 'upon', 'about', 'above', 'below',
  // Filipino stop words
  'ang', 'mga', 'sa', 'ng', 'nang', 'ay', 'at', 'na', 'ito', 'ni', 'kay', 'para',
  'alin', 'ano', 'sino', 'paano', 'kailan', 'bakit', 'saan', 'piliin', 'tamang',
  'salita', 'salitang', 'lahat', 'bilang', 'ayon', 'dahil', 'kung', 'kapag', 'upang',
  'noon', 'ngayon', 'iba', 'ibang', 'nasa', 'may', 'mayroon', 'wala', 'walang',
]);

export interface IterativeEvidenceResult {
  passages: RetrievedPassage[];
  tierUsed: 'tier1_direct' | 'tier2_strict_and' | 'tier3_broad_or' | 'none';
  iterationsRun: string[];
}

export function extractFtsKeywords(text: string, maxKeywords = 6): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FTS_STOP_WORDS.has(w));

  const uniqueKeywords: string[] = [];
  for (const w of words) {
    if (!uniqueKeywords.includes(w)) {
      uniqueKeywords.push(w);
    }
    if (uniqueKeywords.length >= maxKeywords) {
      break;
    }
  }
  return uniqueKeywords;
}

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
    return FTS_STOP_WORDS.has(word);
  }

  /**
   * Executes 3-Tier Progressive Iterative RAG Evidence Retrieval:
   * - Tier 1: Exact Provenance Direct Link (`question_passages`)
   * - Tier 2: Strict FTS5 BM25 Search (`AND`-joined canonical answer + stem terms)
   * - Tier 3: Broad FTS5 BM25 Fallback (`OR`-joined terms & distractor-aware keyword search)
   */
  public async retrieveIterativeEvidence(
    questionId: string,
    stem: string,
    canonicalAnswer?: string,
    distractorText?: string,
    limit = 2
  ): Promise<IterativeEvidenceResult> {
    const results: RetrievedPassage[] = [];
    const seenPassageIds = new Set<string>();
    const iterationsRun: string[] = [];
    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;

    // -------------------------------------------------------------------------
    // Tier 1: Direct question_passages Link
    // -------------------------------------------------------------------------
    iterationsRun.push('Iteration 1: Checking Tier 1 direct `question_passages` link.');
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
        if (!seenPassageIds.has(row.id) && results.length < limit) {
          seenPassageIds.add(row.id);
          results.push({
            passage: this.mapRowToPassage(row),
            strategy: 'linked',
            confidence: row.confidence,
          });
          tier1Count++;
        }
      }
    } catch {
      // Ignore if question_passages table is missing or empty
    }

    // -------------------------------------------------------------------------
    // Tier 2: Strict FTS5 BM25 Search (AND-joined keywords)
    // -------------------------------------------------------------------------
    if (results.length < limit) {
      const searchSource = canonicalAnswer ? `${canonicalAnswer} ${stem}` : stem;
      const strictKeywords = extractFtsKeywords(searchSource, 4);

      if (strictKeywords.length > 0) {
        const strictFtsQuery = strictKeywords.slice(0, 3).map((kw) => `"${kw}"`).join(' AND ');
        iterationsRun.push(`Iteration 2: Running Strict FTS5 BM25 search with query: ${strictFtsQuery}`);

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
          const rows = await this.db.query<PassageRow>(sql, [strictFtsQuery, limit + seenPassageIds.size]);
          for (const row of rows) {
            if (!seenPassageIds.has(row.id) && results.length < limit) {
              seenPassageIds.add(row.id);
              results.push({
                passage: this.mapRowToPassage(row),
                strategy: 'fts5',
                rank: row.rank,
              });
              tier2Count++;
            }
          }
        } catch (e) {
          iterationsRun.push(`Iteration 2 note: FTS5 query degraded: ${e}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Tier 3: Broad FTS5 BM25 Fallback & Distractor-Aware Search (OR-joined keywords)
    // -------------------------------------------------------------------------
    if (results.length < limit) {
      const distractorKeywords = distractorText ? extractFtsKeywords(distractorText, 3) : [];
      const searchSource = canonicalAnswer ? `${canonicalAnswer} ${stem}` : stem;
      const generalKeywords = extractFtsKeywords(searchSource, 6);

      const combinedKeywords = [...distractorKeywords];
      for (const kw of generalKeywords) {
        if (!combinedKeywords.includes(kw)) {
          combinedKeywords.push(kw);
        }
      }

      if (combinedKeywords.length > 0) {
        const broadFtsQuery = combinedKeywords.slice(0, 6).map((kw) => `"${kw}"`).join(' OR ');
        iterationsRun.push(`Iteration 3: Running Broad FTS5 BM25 fallback with query: ${broadFtsQuery}`);

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
          const rows = await this.db.query<PassageRow>(sql, [broadFtsQuery, limit + seenPassageIds.size]);
          for (const row of rows) {
            if (!seenPassageIds.has(row.id) && results.length < limit) {
              seenPassageIds.add(row.id);
              results.push({
                passage: this.mapRowToPassage(row),
                strategy: 'fts5',
                rank: row.rank,
              });
              tier3Count++;
            }
          }
        } catch (e) {
          iterationsRun.push(`Iteration 3 note: FTS5 query degraded: ${e}`);
        }
      }
    }

    let tierUsed: 'tier1_direct' | 'tier2_strict_and' | 'tier3_broad_or' | 'none' = 'none';
    if (tier1Count > 0) {
      tierUsed = 'tier1_direct';
    } else if (tier2Count > 0) {
      tierUsed = 'tier2_strict_and';
    } else if (tier3Count > 0) {
      tierUsed = 'tier3_broad_or';
    }

    return {
      passages: results,
      tierUsed,
      iterationsRun,
    };
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
