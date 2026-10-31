import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
// @ts-ignore
import crypto from 'node:crypto';
import { NodeSqliteDatabase } from '../../src/data/sqlite/sqlite_database.js';
import { SqliteQuestionRepository } from '../../src/data/sqlite/sqlite_question_repository.js';
import { SqlitePassageRetriever } from '../../src/data/sqlite/sqlite_passage_retriever.js';

describe('Empirical Verification: Deployed content_pack.db & SQLite Repositories', () => {
  const proc = (globalThis as any).process;
  const cwd = proc?.cwd ? proc.cwd() : '.';

  const candidates = [
    path.resolve(cwd, 'assets/content_pack.db'),
    path.resolve(cwd, 'mobile/assets/content_pack.db'),
  ];
  let originalDbPath = candidates[0];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      originalDbPath = c;
      break;
    }
  }

  const tempDbPath = path.resolve(path.dirname(originalDbPath), 'content_pack_test_working.db');
  it('verifies original DB asset existence, size, and SHA256 hash match', () => {
    assert.ok(fs.existsSync(originalDbPath), `DB file not found at ${originalDbPath}`);
    const originalStats = fs.statSync(originalDbPath);
    assert.ok(originalStats.size > 0, 'Original DB size must be non-zero');

    const fileBuffer = fs.readFileSync(originalDbPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    assert.equal(hash.length, 64, 'SHA256 hash length must be 64 characters');

    // If training artifact exists, verify bit-for-bit parity
    const trainingDbPath = path.resolve(cwd, 'training/artifacts/content_pack.db');
    if (fs.existsSync(trainingDbPath)) {
      const trainBuffer = fs.readFileSync(trainingDbPath);
      const trainHash = crypto.createHash('sha256').update(trainBuffer).digest('hex');
      assert.equal(hash, trainHash, 'Deployed DB hash must match training artifact hash');
    }
  });

  it('verifies DB pragmas, table counts, and referential integrity', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const integrity = await db.query<{ integrity_check: string }>('PRAGMA integrity_check;');
    assert.equal(integrity[0].integrity_check, 'ok');

    const fkCheck = await db.query<unknown>('PRAGMA foreign_key_check;');
    assert.equal(fkCheck.length, 0, 'Foreign key violations found in deployed DB');

    const [qCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM questions');
    const [pCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM passages');
    const [tCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM topics');
    const [cCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM choices');
    const [qaCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM question_answers');
    const [qpCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM question_passages');
    const [ftsCount] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM passages_fts');

    assert.ok(qCount.c >= 15, `Questions count must be >= 15, got ${qCount.c}`);
    assert.ok(pCount.c >= 8, `Passages count must be >= 8, got ${pCount.c}`);
    assert.ok(tCount.c >= 4, `Topics count must be >= 4, got ${tCount.c}`);
    assert.ok(cCount.c >= qCount.c * 2, `Choices count must be >= 2 per question, got ${cCount.c}`);
    assert.equal(qaCount.c, qCount.c, 'Question answers count must equal questions count');
    assert.ok(qpCount.c >= qCount.c, 'Question passages count must be >= questions count');
    assert.equal(ftsCount.c, pCount.c, 'Passages FTS count must equal passages count');
  });

  it('SqliteQuestionRepository: getTopicSummaries returns all topics with total questions >= 15', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const repo = new SqliteQuestionRepository(db);
    const summaries = await repo.getTopicSummaries();
    assert.ok(summaries.length >= 4, 'Expected at least 4 topic summaries');

    const totalQuestions = summaries.reduce((sum, s) => sum + s.totalQuestions, 0);
    assert.ok(totalQuestions >= 15, `Total questions across all topics must be >= 15, got ${totalQuestions}`);

    for (const summary of summaries) {
      assert.ok(summary.topic.id.length > 0);
      assert.ok(summary.topic.title.length > 0);
      assert.ok(summary.totalQuestions > 0);
      assert.equal(summary.answeredCount, 0, 'Initial answered count should be 0');
      assert.equal(summary.correctCount, 0, 'Initial correct count should be 0');
    }
  });

  it('SqliteQuestionRepository: getQuestionById retrieves question with choices and answer', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const repo = new SqliteQuestionRepository(db);
    const q1 = await repo.getQuestionById('q0001');
    assert.ok(q1 !== null, 'q0001 should exist');
    if (q1) {
      assert.equal(q1.id, 'q0001');
      assert.ok(q1.stem.length > 0);
      assert.ok(q1.choices.length >= 4);
      assert.ok(q1.canonicalChoiceId);
      assert.ok(q1.canonicalAnswer);
      assert.ok(q1.canonicalExplanation);
      assert.ok(q1.sourcePage > 0);
    }

    const nonExistent = await repo.getQuestionById('q_non_existent_9999');
    assert.equal(nonExistent, null);
  });

  it('SqliteQuestionRepository: getNextQuestions handles limits, topic filtering, and exclusions', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const repo = new SqliteQuestionRepository(db);

    const defaultBatch = await repo.getNextQuestions({ mode: 'all' });
    assert.equal(defaultBatch.length, 10, 'Default limit should be 10');

    const limitBatch = await repo.getNextQuestions({ mode: 'all', limit: 5 });
    assert.equal(limitBatch.length, 5, 'Requested limit of 5 should return 5 questions');

    const summaries = await repo.getTopicSummaries();
    const firstTopicId = summaries[0].topic.id;
    const topicQuestions = await repo.getNextQuestions({
      topicId: firstTopicId,
      mode: 'all',
      limit: 20,
    });
    assert.ok(topicQuestions.length > 0);
    for (const q of topicQuestions) {
      assert.equal(q.topicId, firstTopicId, 'All returned questions must match filtered topicId');
    }

    const excludedIds = [defaultBatch[0].id, defaultBatch[1].id];
    const afterExclusion = await repo.getNextQuestions({
      excludeQuestionIds: excludedIds,
      limit: 10,
    });
    for (const q of afterExclusion) {
      assert.ok(!excludedIds.includes(q.id), `Question ${q.id} was excluded but returned`);
    }
  });

  it('SqliteQuestionRepository: handles mode=unanswered, recordAttempt, and mode=weak_areas', async () => {
    // Copy to working DB for mutation testing
    fs.copyFileSync(originalDbPath, tempDbPath);
    try {
      const db = new NodeSqliteDatabase(tempDbPath);
      const repo = new SqliteQuestionRepository(db);

      const [totalQRow] = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM questions');
      const totalCount = totalQRow.c;

      const unansweredBefore = await repo.getNextQuestions({ mode: 'unanswered', limit: totalCount });
      assert.equal(unansweredBefore.length, totalCount, `Initially all ${totalCount} questions are unanswered`);

      const targetQ1 = unansweredBefore[0];
      const targetQ2 = unansweredBefore[1];

      const wrongChoice = targetQ1.choices.find((c) => c.id !== targetQ1.canonicalChoiceId) ?? targetQ1.choices[0];
      const correctChoice = targetQ2.canonicalChoiceId ?? targetQ2.choices[0]?.id;

      // Record an incorrect attempt on targetQ1
      await repo.recordAttempt({
        id: 'att_001',
        questionId: targetQ1.id,
        selectedChoiceId: wrongChoice.id,
        isCorrect: false,
        score: 0.0,
        durationMs: 5000,
        answeredAt: new Date().toISOString(),
      });

      // Record a second incorrect attempt on targetQ1 (heavy failure)
      await repo.recordAttempt({
        id: 'att_002',
        questionId: targetQ1.id,
        selectedChoiceId: wrongChoice.id,
        isCorrect: false,
        score: 0.0,
        durationMs: 4000,
        answeredAt: new Date().toISOString(),
      });

      // Record a correct attempt on targetQ2
      await repo.recordAttempt({
        id: 'att_003',
        questionId: targetQ2.id,
        selectedChoiceId: correctChoice,
        isCorrect: true,
        score: 1.0,
        durationMs: 3000,
        answeredAt: new Date().toISOString(),
      });

      // Verify mode=unanswered now excludes targetQ1 and targetQ2
      const unansweredAfter = await repo.getNextQuestions({ mode: 'unanswered', limit: totalCount });
      assert.equal(unansweredAfter.length, totalCount - 2, `Should have ${totalCount - 2} unanswered questions remaining`);
      const remainingIds = new Set(unansweredAfter.map((q) => q.id));
      assert.ok(!remainingIds.has(targetQ1.id), 'targetQ1 should no longer be in unanswered');
      assert.ok(!remainingIds.has(targetQ2.id), 'targetQ2 should no longer be in unanswered');

      // Verify mode=weak_areas prioritizes targetQ1 (most failed)
      const weakAreas = await repo.getNextQuestions({ mode: 'weak_areas', limit: 5 });
      assert.ok(weakAreas.length > 0);
      assert.equal(weakAreas[0].id, targetQ1.id, 'Weak areas mode must prioritize most failed question at top');

      // Verify getTopicSummaries reflects recorded attempts
      const updatedSummaries = await repo.getTopicSummaries();
      const totalAnswered = updatedSummaries.reduce((sum, s) => sum + s.answeredCount, 0);
      const totalCorrect = updatedSummaries.reduce((sum, s) => sum + s.correctCount, 0);
      assert.equal(totalAnswered, 2, '2 distinct questions should be recorded as answered');
      assert.equal(totalCorrect, 1, '1 question should be recorded as correct');
    } finally {
      if (fs.existsSync(tempDbPath)) {
        try {
          fs.unlinkSync(tempDbPath);
        } catch {
          // ignore
        }
      }
    }

    // Verify original DB remains untouched
    const finalBuffer = fs.readFileSync(originalDbPath);
    const finalHash = crypto.createHash('sha256').update(finalBuffer).digest('hex');
    const trainingDbPath = path.resolve(cwd, 'training/artifacts/content_pack.db');
    if (fs.existsSync(trainingDbPath)) {
      const trainBuffer = fs.readFileSync(trainingDbPath);
      const trainHash = crypto.createHash('sha256').update(trainBuffer).digest('hex');
      assert.equal(finalHash, trainHash, 'Original DB was mutated during test execution!');
    }
  });

  it('SqlitePassageRetriever: retrieves Tier 1 linked passages with verified confidence', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const retriever = new SqlitePassageRetriever(db);

    const linked = await retriever.retrieveForQuestion('q0001', 'sample stem', 3);
    assert.ok(linked.length > 0, 'Expected at least 1 linked passage for q0001');
    assert.equal(linked[0].strategy, 'linked');
    assert.equal(linked[0].confidence, 'verified');
    assert.ok(linked[0].passage.text.length > 0);
    assert.ok(linked[0].passage.chapter.length > 0);
  });

  it('SqlitePassageRetriever: executes FTS5 BM25 search across curriculum queries', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const retriever = new SqlitePassageRetriever(db);

    const searchTerms = ['context clues', 'synonym', 'antonym', 'vocabulary', 'meaning'];
    for (const term of searchTerms) {
      const results = await retriever.searchPassages(term, 3);
      assert.ok(results.length > 0, `Search for "${term}" returned 0 results`);
      assert.equal(results[0].strategy, 'fts5');
      assert.ok(typeof results[0].rank === 'number', 'Rank should be numeric BM25 score');
      assert.ok(results[0].rank! < 0, 'BM25 score in SQLite should be negative');
    }
  });

  it('SqlitePassageRetriever: executes 3-Tier iterative evidence retrieval gracefully', async () => {
    const db = new NodeSqliteDatabase(originalDbPath);
    const retriever = new SqlitePassageRetriever(db);

    // 1. Direct link hit (Tier 1)
    const tier1 = await retriever.retrieveIterativeEvidence(
      'q0001',
      'The Vice-President act was absolutely treacherous',
      'betrayal'
    );
    assert.ok(tier1.passages.length > 0);
    assert.equal(tier1.passages[0].strategy, 'linked');
    assert.ok(tier1.iterationsRun.length >= 1);

    // 2. Unlinked question fallback to FTS5 search (Tier 2 / Tier 3)
    const ftsFallback = await retriever.retrieveIterativeEvidence(
      'q_synthetic_unlinked',
      'synonyms context clues vocabulary',
      'hazardous',
      'commendable',
      2
    );
    assert.ok(ftsFallback.passages.length > 0);
    assert.equal(ftsFallback.passages[0].strategy, 'fts5');

    // 3. Robustness on adversarial inputs
    const adversarial = await retriever.retrieveIterativeEvidence(
      'q_empty',
      '*** ??? !!!',
      '',
      '',
      2
    );
    assert.ok(Array.isArray(adversarial.passages));
  });
});
