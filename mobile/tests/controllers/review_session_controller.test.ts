import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NodeSqliteDatabase } from '../../src/data/sqlite/sqlite_database.js';
import { INITIAL_SCHEMA_SQL } from '../../src/data/sqlite/schema.js';
import { ContentPackImporter } from '../../src/data/content_pack/content_pack_importer.js';
import { SqliteQuestionRepository } from '../../src/data/sqlite/sqlite_question_repository.js';
import { SqlitePassageRetriever } from '../../src/data/sqlite/sqlite_passage_retriever.js';
import { MockLocalLlmAdapter } from '../../src/ai/runtime/mock_local_llm_adapter.js';
import { LocalLlmService } from '../../src/ai/runtime/local_llm_service.js';
import { DiagnosticsLogger } from '../../src/diagnostics/diagnostics_logger.js';

// Use cases
import { InitializeApp } from '../../src/application/use_cases/initialize_app.js';
import { GetNextQuestion } from '../../src/application/use_cases/get_next_question.js';
import { SubmitAnswer } from '../../src/application/use_cases/submit_answer.js';
import { GetExplanationContext } from '../../src/application/use_cases/get_explanation_context.js';
import { ExplainMore } from '../../src/application/use_cases/explain_more.js';
import { InterpretFreeAnswer } from '../../src/application/use_cases/interpret_free_answer.js';
import { CancelGeneration } from '../../src/application/use_cases/cancel_generation.js';

// Controller
import {
  ReviewSessionController,
  ReviewSessionState,
} from '../../src/controllers/review_session_controller.js';

describe('ReviewSessionController & SQLite Migration Safeguard', () => {
  let db: NodeSqliteDatabase;
  let questionRepo: SqliteQuestionRepository;
  let passageRetriever: SqlitePassageRetriever;
  let importer: ContentPackImporter;
  let mockAdapter: MockLocalLlmAdapter;
  let llmService: LocalLlmService;
  let logger: DiagnosticsLogger;

  let getNextQuestion: GetNextQuestion;
  let submitAnswer: SubmitAnswer;
  let getExplanationContext: GetExplanationContext;
  let explainMore: ExplainMore;
  let interpretFreeAnswer: InterpretFreeAnswer;
  let cancelGeneration: CancelGeneration;

  let controller: ReviewSessionController;

  beforeEach(async () => {
    db = new NodeSqliteDatabase(':memory:');
    await db.execute(INITIAL_SCHEMA_SQL);
    logger = new DiagnosticsLogger(50);
    logger.clear();

    importer = new ContentPackImporter(db, logger);
    questionRepo = new SqliteQuestionRepository(db);
    passageRetriever = new SqlitePassageRetriever(db);
    mockAdapter = new MockLocalLlmAdapter();
    llmService = new LocalLlmService({ adapter: mockAdapter, logger });

    // Seed test pack with 2 questions (1 MC, 1 Identification)
    await importer.importPack({
      metadata: {
        pack_id: 'ph-civil-service',
        version: '2026.10.1',
        source_revision: 'main',
        imported_at: new Date().toISOString(),
        content_hash: 'hash-pack',
      },
      topics: [{ id: 't1', title: 'Constitutional Law', sort_order: 1 }],
      passages: [
        {
          id: 'p1',
          chapter: 'Constitutional Commissions',
          section: 'CSC',
          start_page: 25,
          end_page: 26,
          text: 'The Civil Service Commission is the central personnel agency of the Philippine Government.',
          content_hash: 'hash_p1',
        },
      ],
      questions: [
        {
          id: 'q1',
          topic_id: 't1',
          question_type: 'multiple_choice',
          stem: 'What is the central personnel agency of the Philippine government?',
          canonical_explanation: 'Article IX-B Section 3 states that CSC is the central personnel agency.',
          source_page: 25,
          content_version: '2026.10.1',
        },
        {
          id: 'q2',
          topic_id: 't1',
          question_type: 'identification',
          stem: 'Identify the central personnel agency of the Philippine Government.',
          canonical_explanation: 'The Civil Service Commission (CSC).',
          source_page: 25,
          content_version: '2026.10.1',
        },
      ],
      choices: [
        { id: 'c1', question_id: 'q1', choice_key: 'A', text: 'Civil Service Commission', sort_order: 1 },
        { id: 'c2', question_id: 'q1', choice_key: 'B', text: 'Department of Budget and Management', sort_order: 2 },
      ],
      question_answers: [
        { question_id: 'q1', canonical_choice_id: 'c1' },
        { question_id: 'q2', canonical_answer: 'Civil Service Commission' },
      ],
      question_passages: [
        {
          question_id: 'q1',
          passage_id: 'p1',
          link_type: 'verified',
          confidence: 'verified',
          reviewer_status: 'approved',
        },
        {
          question_id: 'q2',
          passage_id: 'p1',
          link_type: 'verified',
          confidence: 'verified',
          reviewer_status: 'approved',
        },
      ],
    });

    // Instantiate use cases
    getNextQuestion = new GetNextQuestion({ repository: questionRepo });
    submitAnswer = new SubmitAnswer(questionRepo);
    getExplanationContext = new GetExplanationContext(questionRepo, passageRetriever);
    explainMore = new ExplainMore(questionRepo, passageRetriever, llmService, logger);
    interpretFreeAnswer = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);
    cancelGeneration = new CancelGeneration(logger);

    controller = new ReviewSessionController({
      getNextQuestion,
      submitAnswer,
      getExplanationContext,
      explainMore,
      interpretFreeAnswer,
      cancelGeneration,
      logger,
    });
  });

  it('1. startSession: initializes session, loads questions and sets first question', async () => {
    let notifiedState: ReviewSessionState | null = null;
    controller.subscribe((state) => {
      notifiedState = state;
    });

    await controller.startSession({
      query: { mode: 'all' },
      sessionSeed: 'test-seed-123',
      sessionId: 'session-alpha',
    });

    const state = controller.getState();
    assert.equal(state.sessionId, 'session-alpha');
    assert.equal(state.totalQuestions, 2);
    assert.equal(state.currentIndex, 0);
    assert.equal(state.currentQuestion?.id, 'q1');
    assert.equal(state.isSessionCompleted, false);
    assert.equal(state.isSubmitted, false);
    assert.equal(state.selectedChoiceId, null);
    assert.deepEqual(state.sourcePages, [25]);
    assert.equal(notifiedState !== null, true);
  });

  it('2. selectChoice & submitCurrentAnswer: records multiple choice answer deterministically', async () => {
    await controller.startSession({ query: { mode: 'all' } });

    controller.selectChoice('c1');
    assert.equal(controller.getState().selectedChoiceId, 'c1');

    const result = await controller.submitCurrentAnswer();
    assert.notEqual(result, null);
    assert.equal(result?.isCorrect, true);
    assert.equal(result?.score, 1.0);

    const state = controller.getState();
    assert.equal(state.isSubmitted, true);
    assert.equal(state.submissionResult?.attempt.id.startsWith('att_'), true);
    assert.equal(state.supportingPassages.length > 0, true);
    assert.equal(state.supportingPassages[0].passage.id, 'p1');
    assert.deepEqual(state.sourcePages, [25, 26]);

    // Submitting again is idempotent
    const secondSubmit = await controller.submitCurrentAnswer();
    assert.equal(secondSubmit?.attempt.id, result?.attempt.id);
  });

  it('3. requestExplainMore: retrieves grounded AI explanation with source pages', async () => {
    mockAdapter.setResponses([
      'Ang Civil Service Commission (CSC) ay ang pangunahing ahensya ng gobyerno sang-ayon sa Saligang Batas.',
    ]);

    await controller.startSession({ query: { mode: 'all' } });
    await controller.submitCurrentAnswer();

    const explanationResult = await controller.requestExplainMore('fil');
    assert.notEqual(explanationResult, null);
    assert.equal(
      explanationResult?.explanation.includes('Civil Service Commission'),
      true
    );

    const state = controller.getState();
    assert.equal(state.isGeneratingAi, false);
    assert.equal(state.aiExplanation, explanationResult?.explanation);
    assert.equal(state.aiError, null);
  });

  it('4. cancelActiveAiGeneration: aborts in-flight AI generation cleanly', async () => {
    // Configure delay to allow in-flight cancellation
    mockAdapter.setOptions({
      chunkDelayMs: 50,
      responses: ['Paliwanag na medyo mahaba at mabagal...'],
    });

    await controller.startSession({ query: { mode: 'all' } });
    await controller.submitCurrentAnswer();

    // Trigger asynchronous explainMore
    const explainPromise = controller.requestExplainMore('fil');

    // Immediately cancel
    const didCancel = controller.cancelActiveAiGeneration();
    assert.equal(didCancel, true);

    await explainPromise;

    const state = controller.getState();
    assert.equal(state.isGeneratingAi, false);
    assert.equal(state.aiError, 'Generation cancelled');
  });

  it('5. requestFreeAnswerInterpretation: evaluates free text identification answer', async () => {
    await controller.startSession({ query: { mode: 'all' } });

    // Move to question 2 (Identification)
    const nextQ = controller.nextQuestion();
    assert.equal(nextQ?.id, 'q2');

    controller.setFreeTextInput('Civil Service Commission');
    assert.equal(controller.getState().freeTextInput, 'Civil Service Commission');

    // Submit answer deterministically
    const submitRes = await controller.submitCurrentAnswer();
    assert.equal(submitRes?.isCorrect, true);
    assert.equal(submitRes?.score, 1.0);

    // Mock LLM verdict
    mockAdapter.setResponses([
      JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: ['Civil Service Commission'],
        missing_concepts: [],
        evidence_passage_ids: ['p1'],
        confidence: 0.95,
      }),
    ]);

    const evalResult = await controller.requestFreeAnswerInterpretation();
    assert.notEqual(evalResult, null);
    assert.equal(evalResult?.verdict.verdict, 'equivalent');
    assert.equal(evalResult?.verdict.requiresManualReview, false);

    const state = controller.getState();
    assert.equal(state.freeAnswerEvaluation?.verdict, 'equivalent');
    assert.equal(state.isGeneratingAi, false);
    assert.equal(state.aiError, null);
  });

  it('6. nextQuestion: resets state per question and completes session at end', async () => {
    await controller.startSession({ query: { mode: 'all' } });

    assert.equal(controller.getState().currentIndex, 0);
    assert.equal(controller.getState().currentQuestion?.id, 'q1');

    // Advance to q2
    const q2 = controller.nextQuestion();
    assert.equal(q2?.id, 'q2');
    assert.equal(controller.getState().currentIndex, 1);
    assert.equal(controller.getState().isSubmitted, false);
    assert.equal(controller.getState().selectedChoiceId, null);
    assert.equal(controller.getState().freeTextInput, '');

    // Advance past q2
    const q3 = controller.nextQuestion();
    assert.equal(q3, null);
    assert.equal(controller.getState().isSessionCompleted, true);
    assert.equal(controller.getState().currentQuestion, null);
  });

  it('7. subscribe: notifies listeners on state changes and supports unsubscribe', async () => {
    let callCount = 0;
    const unsubscribe = controller.subscribe(() => {
      callCount++;
    });

    await controller.startSession({ query: { mode: 'all' } });
    assert.equal(callCount > 0, true);

    const countBeforeUnsub = callCount;
    unsubscribe();

    controller.selectChoice('c1');
    assert.equal(callCount, countBeforeUnsub); // No further calls after unsubscribe
  });

  it('8. Database Migration Safeguard: defends against missing score column in legacy database', async () => {
    // Construct a legacy database missing the `score` column in answer_attempts
    const legacyDb = new NodeSqliteDatabase(':memory:');
    await legacyDb.execute(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id),
          question_type TEXT NOT NULL,
          stem TEXT NOT NULL,
          canonical_explanation TEXT,
          source_page INTEGER NOT NULL,
          difficulty TEXT,
          content_version TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS choices (
          id TEXT PRIMARY KEY,
          question_id TEXT NOT NULL REFERENCES questions(id),
          choice_key TEXT NOT NULL,
          text TEXT NOT NULL,
          sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_answers (
          question_id TEXT PRIMARY KEY REFERENCES questions(id),
          canonical_choice_id TEXT REFERENCES choices(id),
          canonical_answer TEXT
      );

      -- Legacy answer_attempts without score column
      CREATE TABLE IF NOT EXISTS answer_attempts (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          question_id TEXT NOT NULL REFERENCES questions(id),
          selected_choice_id TEXT REFERENCES choices(id),
          free_text_answer TEXT,
          is_correct INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          answered_at TEXT NOT NULL
      );
    `);

    // Verify score column is currently absent
    const preColumns = await legacyDb.query<{ name: string }>(
      "PRAGMA table_info('answer_attempts')"
    );
    assert.equal(preColumns.some((col) => col.name === 'score'), false);

    // Insert a legacy row
    await legacyDb.execute(`
      INSERT INTO topics VALUES ('t1', 'General Info', 1);
      INSERT INTO questions VALUES ('q1', 't1', 'multiple_choice', 'Sample stem', NULL, 1, 'easy', 'v1');
      INSERT INTO choices VALUES ('c1', 'q1', 'A', 'Choice A', 1);
      INSERT INTO answer_attempts VALUES ('att_legacy', NULL, 'q1', 'c1', NULL, 1, 1200, '2026-01-01T00:00:00Z');
    `);

    // Execute InitializeApp to run defensive migration
    const legacyInit = new InitializeApp({
      db: legacyDb,
      llmPort: llmService,
      logger,
    });
    const initResult = await legacyInit.execute();
    assert.equal(initResult.isReady, true);

    // Verify score column now exists with default 0.0
    const postColumns = await legacyDb.query<{ name: string }>(
      "PRAGMA table_info('answer_attempts')"
    );
    assert.equal(postColumns.some((col) => col.name === 'score'), true);

    // Verify pre-existing row preserved with default score 0.0
    const legacyRow = await legacyDb.queryOne<{ id: string; score: number }>(
      "SELECT id, score FROM answer_attempts WHERE id = 'att_legacy'"
    );
    assert.notEqual(legacyRow, null);
    assert.equal(legacyRow?.id, 'att_legacy');
    assert.equal(legacyRow?.score, 0.0);

    // Verify new insert with score works cleanly
    const legacyRepo = new SqliteQuestionRepository(legacyDb);
    await legacyRepo.recordAttempt({
      id: 'att_new',
      sessionId: null,
      questionId: 'q1',
      selectedChoiceId: 'c1',
      freeTextAnswer: null,
      isCorrect: true,
      score: 1.0,
      durationMs: 1500,
      answeredAt: new Date().toISOString(),
    });

    const newRow = await legacyDb.queryOne<{ id: string; score: number }>(
      "SELECT id, score FROM answer_attempts WHERE id = 'att_new'"
    );
    assert.equal(newRow?.score, 1.0);
  });

  it('9. rateCurrentFlashcard: rating "again" records 0.0 attempt, re-queues missed card, and rating "know" records 1.0', async () => {
    await controller.startSession({ query: { mode: 'all' } });

    // Initial state: totalQuestions = 2, currentIndex = 0 (q1)
    assert.equal(controller.getState().totalQuestions, 2);
    assert.equal(controller.getState().currentIndex, 0);
    assert.equal(controller.getState().currentQuestion?.id, 'q1');

    // Rate 'again' on q1 (missed card)
    const resultAgain = await controller.rateCurrentFlashcard('again');
    assert.notEqual(resultAgain, null);
    assert.equal(resultAgain?.isCorrect, false);
    assert.equal(resultAgain?.score, 0.0);

    // Controller should have re-queued q1 at the end and advanced to q2
    const stateAfterAgain = controller.getState();
    assert.equal(stateAfterAgain.totalQuestions, 3);
    assert.equal(stateAfterAgain.currentIndex, 1);
    assert.equal(stateAfterAgain.currentQuestion?.id, 'q2');
    assert.equal(stateAfterAgain.questions.length, 3);
    assert.equal(stateAfterAgain.questions[2].id, 'q1');

    // Rate 'know' on q2
    const resultKnow = await controller.rateCurrentFlashcard('know');
    assert.notEqual(resultKnow, null);
    assert.equal(resultKnow?.isCorrect, true);
    assert.equal(resultKnow?.score, 1.0);

    // Should advance to index 2 (the re-queued q1)
    const stateAfterQ2 = controller.getState();
    assert.equal(stateAfterQ2.currentIndex, 2);
    assert.equal(stateAfterQ2.currentQuestion?.id, 'q1');
    assert.equal(stateAfterQ2.isSessionCompleted, false);

    // Rate 'know' on re-queued q1
    await controller.rateCurrentFlashcard('know');
    assert.equal(controller.getState().isSessionCompleted, true);
  });

  it('10. streamingAiText: receives streamed chunks during requestExplainMore', async () => {
    mockAdapter.setOptions({
      chunkDelayMs: 10,
      responses: ['Ang Civil Service Commission ay ang sentral na ahensya ng gobyerno.'],
    });

    await controller.startSession({ query: { mode: 'all' } });
    await controller.submitCurrentAnswer();

    const streamedChunks: string[] = [];
    controller.subscribe((state) => {
      if (state.streamingAiText) {
        streamedChunks.push(state.streamingAiText);
      }
    });

    await controller.requestExplainMore('fil');

    assert.ok(streamedChunks.length > 1, 'Should have received multiple intermediate streaming updates');
    assert.equal(
      controller.getState().streamingAiText,
      'Ang Civil Service Commission ay ang sentral na ahensya ng gobyerno.'
    );
  });

  it('11. rateCurrentFlashcard: prevents concurrent rating execution (rapid multiple presses)', async () => {
    await controller.startSession({ query: { mode: 'all' } });

    assert.equal(controller.getState().currentIndex, 0);
    assert.equal(controller.getState().totalQuestions, 2);

    // Simulate rapid concurrent taps on "Review Again"
    const [res1, res2] = await Promise.all([
      controller.rateCurrentFlashcard('again'),
      controller.rateCurrentFlashcard('again'),
    ]);

    // One must succeed and the other must be rejected by the concurrency guard
    const results = [res1, res2];
    const successes = results.filter((r) => r !== null);
    const rejections = results.filter((r) => r === null);

    assert.equal(successes.length, 1, 'Only one rating call should be accepted');
    assert.equal(rejections.length, 1, 'Concurrent rating call should be rejected');

    // Queue must only have grown by 1 (totalQuestions 3, currentIndex 1)
    const state = controller.getState();
    assert.equal(state.totalQuestions, 3);
    assert.equal(state.currentIndex, 1);
    assert.equal(state.currentQuestion?.id, 'q2');
  });

  it('12. rateCurrentFlashcard: safely handles question when choices are limited without foreign key errors', async () => {
    // Add question with only 1 choice (which is the canonical choice)
    await importer.importPack({
      metadata: {
        pack_id: 'ph-civil-service',
        version: '2026.10.1',
        source_revision: 'main',
        imported_at: new Date().toISOString(),
        content_hash: 'hash-pack',
      },
      topics: [{ id: 't1', title: 'Constitutional Law', sort_order: 1 }],
      passages: [],
      questions: [
        {
          id: 'q_single',
          topic_id: 't1',
          question_type: 'multiple_choice',
          stem: 'Single choice question',
          source_page: 25,
          content_version: '2026.10.1',
        },
      ],
      choices: [
        { id: 'c_only', question_id: 'q_single', choice_key: 'A', text: 'Sole option', sort_order: 1 },
      ],
      question_answers: [
        { question_id: 'q_single', canonical_choice_id: 'c_only' },
      ],
      question_passages: [],
    });

    await controller.startSession({ query: { mode: 'all' } });
    // Navigate to q_single (which is index 2)
    controller.nextQuestion();
    controller.nextQuestion();
    assert.equal(controller.getState().currentQuestion?.id, 'q_single');

    // Rating 'again' where no non-canonical choice exists must NOT throw foreign key violation
    const result = await controller.rateCurrentFlashcard('again');
    assert.notEqual(result, null);
    assert.equal(result?.isCorrect, false);
    assert.equal(result?.score, 0.0);
  });
});
