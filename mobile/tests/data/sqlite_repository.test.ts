import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NodeSqliteDatabase } from '../../src/data/sqlite/sqlite_database.js';
import { INITIAL_SCHEMA_SQL } from '../../src/data/sqlite/schema.js';
import { ContentPackImporter, ContentPackData } from '../../src/data/content_pack/content_pack_importer.js';
import { SqliteQuestionRepository } from '../../src/data/sqlite/sqlite_question_repository.js';
import { SqlitePassageRetriever } from '../../src/data/sqlite/sqlite_passage_retriever.js';

describe('Data Layer: SQLite Repositories & Content Pack Importer', () => {
  let db: NodeSqliteDatabase;
  let importer: ContentPackImporter;
  let questionRepo: SqliteQuestionRepository;
  let passageRetriever: SqlitePassageRetriever;

  const mockPack: ContentPackData = {
    metadata: {
      pack_id: 'civil-service-2026',
      version: '2026.10.1',
      source_revision: 'git-rev-abc',
      imported_at: new Date().toISOString(),
      content_hash: 'hash-pack-12345',
    },
    topics: [
      { id: 'top_consti', title: 'Philippine Constitution', sort_order: 1 },
      { id: 'top_ethics', title: 'Code of Conduct & Ethics', sort_order: 2 },
    ],
    passages: [
      {
        id: 'p0001',
        chapter: 'The Executive Department',
        section: 'Powers of the President',
        start_page: 10,
        end_page: 11,
        text: 'The executive power shall be vested in the President of the Philippines.',
        content_hash: 'hash_p1',
      },
      {
        id: 'p0002',
        chapter: 'The Legislative Department',
        section: 'Composition of Congress',
        start_page: 14,
        end_page: 15,
        text: 'The legislative power shall be vested in the Congress of the Philippines which shall consist of a Senate and a House of Representatives.',
        content_hash: 'hash_p2',
      },
    ],
    questions: [
      {
        id: 'q0001',
        topic_id: 'top_consti',
        question_type: 'multiple_choice',
        stem: 'Where is executive power vested?',
        canonical_explanation: 'Article VII Section 1 vests it in the President.',
        source_page: 10,
        difficulty: 'easy',
        content_version: '2026.10.1',
      },
      {
        id: 'q0002',
        topic_id: 'top_consti',
        question_type: 'multiple_choice',
        stem: 'Where is legislative power vested?',
        canonical_explanation: 'Article VI Section 1 vests it in Congress.',
        source_page: 14,
        difficulty: 'medium',
        content_version: '2026.10.1',
      },
    ],
    choices: [
      { id: 'c0001_a', question_id: 'q0001', choice_key: 'A', text: 'President', sort_order: 1 },
      { id: 'c0001_b', question_id: 'q0001', choice_key: 'B', text: 'Prime Minister', sort_order: 2 },
      { id: 'c0002_a', question_id: 'q0002', choice_key: 'A', text: 'Supreme Court', sort_order: 1 },
      { id: 'c0002_b', question_id: 'q0002', choice_key: 'B', text: 'Congress', sort_order: 2 },
    ],
    question_answers: [
      { question_id: 'q0001', canonical_choice_id: 'c0001_a' },
      { question_id: 'q0002', canonical_choice_id: 'c0002_b' },
    ],
    question_passages: [
      {
        question_id: 'q0001',
        passage_id: 'p0001',
        link_type: 'direct',
        confidence: 'verified',
        reviewer_status: 'approved',
      },
    ],
  };

  beforeEach(async () => {
    db = new NodeSqliteDatabase(':memory:');
    await db.execute(INITIAL_SCHEMA_SQL);
    importer = new ContentPackImporter(db);
    questionRepo = new SqliteQuestionRepository(db);
    passageRetriever = new SqlitePassageRetriever(db);
  });

  it('imports content pack atomically and populates all tables and FTS5', async () => {
    const success = await importer.importPack(mockPack);
    assert.equal(success, true);

    const activeMeta = await importer.getActivePackMetadata();
    assert.equal(activeMeta?.pack_id, 'civil-service-2026');
    assert.equal(activeMeta?.version, '2026.10.1');

    const q1 = await questionRepo.getQuestionById('q0001');
    assert.ok(q1);
    assert.equal(q1!.stem, 'Where is executive power vested?');
    assert.equal(q1!.canonicalChoiceId, 'c0001_a');
    assert.equal(q1!.choices.length, 2);
  });

  it('preserves existing learner answer_attempts and sessions across pack imports', async () => {
    await importer.importPack(mockPack);

    // Record learner session and attempt
    await db.execute(
      "INSERT INTO study_sessions (id, started_at, mode) VALUES ('sess_01', '2026-10-16T10:00:00Z', 'exam')"
    );
    await questionRepo.recordAttempt({
      id: 'att_01',
      sessionId: 'sess_01',
      questionId: 'q0001',
      selectedChoiceId: 'c0001_a',
      isCorrect: true,
      score: 1.0,
      durationMs: 4500,
      answeredAt: '2026-10-16T10:01:00Z',
    });

    const attemptsBefore = await db.query('SELECT * FROM answer_attempts');
    assert.equal(attemptsBefore.length, 1);

    // Now import updated content pack
    const updatedPack: ContentPackData = {
      ...mockPack,
      metadata: {
        ...mockPack.metadata,
        version: '2026.10.2',
      },
    };
    await importer.importPack(updatedPack);

    // Verify attempt is still intact!
    const attemptsAfter = await db.query('SELECT * FROM answer_attempts');
    assert.equal(attemptsAfter.length, 1);

    const sessionAfter = await db.query('SELECT * FROM study_sessions');
    assert.equal(sessionAfter.length, 1);
  });

  it('filters questions by mode: unanswered and weak_areas', async () => {
    await importer.importPack(mockPack);

    // Initially both are unanswered
    const unanswered1 = await questionRepo.getNextQuestions({ mode: 'unanswered' });
    assert.equal(unanswered1.length, 2);

    // Answer q0001 incorrectly
    await questionRepo.recordAttempt({
      id: 'att_fail',
      questionId: 'q0001',
      isCorrect: false,
      score: 0.0,
      durationMs: 3000,
      answeredAt: new Date().toISOString(),
    });

    // Now only q0002 is unanswered
    const unanswered2 = await questionRepo.getNextQuestions({ mode: 'unanswered' });
    assert.equal(unanswered2.length, 1);
    assert.equal(unanswered2[0]?.id, 'q0002');

    // Weak areas query should prioritize failed question q0001
    const weakQuestions = await questionRepo.getNextQuestions({ mode: 'weak_areas' });
    assert.equal(weakQuestions[0]?.id, 'q0001');
  });

  it('calculates topic summaries correctly', async () => {
    await importer.importPack(mockPack);

    await questionRepo.recordAttempt({
      id: 'att_top',
      questionId: 'q0001',
      isCorrect: true,
      score: 1.0,
      durationMs: 2000,
      answeredAt: new Date().toISOString(),
    });

    const summaries = await questionRepo.getTopicSummaries();
    assert.equal(summaries.length, 2);

    const constiTopic = summaries.find((s) => s.topic.id === 'top_consti');
    assert.ok(constiTopic);
    assert.equal(constiTopic!.totalQuestions, 2);
    assert.equal(constiTopic!.answeredCount, 1);
    assert.equal(constiTopic!.correctCount, 1);
  });

  it('retrieves linked passages first (Tier 1) and falls back to FTS5 BM25 (Tier 2)', async () => {
    await importer.importPack(mockPack);

    // Question 1 has a direct link to p0001
    const q1Passages = await passageRetriever.retrieveForQuestion('q0001', 'executive power president', 2);
    assert.ok(q1Passages.length >= 1);
    assert.equal(q1Passages[0]?.passage.id, 'p0001');
    assert.equal(q1Passages[0]?.strategy, 'linked');

    // Question 2 has no direct link, should fall back to FTS5 search on Congress
    const q2Passages = await passageRetriever.retrieveForQuestion('q0002', 'Where is legislative power in Congress?', 2);
    assert.ok(q2Passages.length >= 1);
    assert.equal(q2Passages[0]?.passage.id, 'p0002');
    assert.equal(q2Passages[0]?.strategy, 'fts5');
  });

  it('persists partial credit score (0.5) in answer_attempts', async () => {
    await importer.importPack(mockPack);

    await questionRepo.recordAttempt({
      id: 'att_partial',
      questionId: 'q0001',
      isCorrect: false,
      score: 0.5,
      freeTextAnswer: 'Partially correct explanation',
      durationMs: 5000,
      answeredAt: new Date().toISOString(),
    });

    const rows = await db.query<{ score: number; is_correct: number; free_text_answer: string }>(
      'SELECT score, is_correct, free_text_answer FROM answer_attempts WHERE id = ?',
      ['att_partial']
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.score, 0.5);
    assert.equal(rows[0]?.is_correct, 0);
    assert.equal(rows[0]?.free_text_answer, 'Partially correct explanation');
  });

  it('rolls back completely when import fails midway, leaving previously active pack usable', async () => {
    // 1. Install initial valid pack
    await importer.importPack(mockPack);
    const initialMeta = await importer.getActivePackMetadata();
    assert.equal(initialMeta?.version, '2026.10.1');

    // 2. Attempt to import an invalid pack that will fail relational validation
    const brokenPack: ContentPackData = {
      ...mockPack,
      metadata: {
        ...mockPack.metadata,
        version: '2026.10.3-broken',
      },
      questions: [
        {
          id: 'q_orphan',
          topic_id: 'non_existent_topic_id', // Violates topic existence
          question_type: 'multiple_choice',
          stem: 'Orphan question',
          source_page: 99,
          content_version: '2026.10.3',
        },
      ],
    };

    await assert.rejects(
      async () => await importer.importPack(brokenPack),
      (err: any) => err.message.includes('non-existent topic')
    );

    // 3. Verify original content pack remains 100% active and usable!
    const activeMeta = await importer.getActivePackMetadata();
    assert.equal(activeMeta?.version, '2026.10.1');

    const q1 = await questionRepo.getQuestionById('q0001');
    assert.ok(q1);
    assert.equal(q1!.stem, 'Where is executive power vested?');
  });
});
