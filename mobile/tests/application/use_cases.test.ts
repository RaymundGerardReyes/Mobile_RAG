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
import { ModelAssetStore, VerifiedModelAsset } from '../../src/application/ports/model_asset_store.js';

// Use cases
import { InitializeApp } from '../../src/application/use_cases/initialize_app.js';
import { GetNextQuestion } from '../../src/application/use_cases/get_next_question.js';
import { SubmitAnswer } from '../../src/application/use_cases/submit_answer.js';
import { GetExplanationContext } from '../../src/application/use_cases/get_explanation_context.js';
import { ExplainMore } from '../../src/application/use_cases/explain_more.js';
import { InterpretFreeAnswer } from '../../src/application/use_cases/interpret_free_answer.js';
import { CancelGeneration } from '../../src/application/use_cases/cancel_generation.js';
import { CheckModelReadiness } from '../../src/application/use_cases/check_model_readiness.js';
import { ExportDiagnostics } from '../../src/application/use_cases/export_diagnostics.js';

describe('Application Layer: All 9 Core Use Cases', () => {
  let db: NodeSqliteDatabase;
  let questionRepo: SqliteQuestionRepository;
  let passageRetriever: SqlitePassageRetriever;
  let importer: ContentPackImporter;
  let mockAdapter: MockLocalLlmAdapter;
  let llmService: LocalLlmService;
  let logger: DiagnosticsLogger;

  class FakeAssetStore implements ModelAssetStore {
    public validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    public async resolveModelAsset(manifestId?: string): Promise<VerifiedModelAsset | null> {
      return {
        manifestId: manifestId || 'qwen-0.5b-q4',
        modelName: 'model.gguf',
        modelPath: '/app/models/model.gguf',
        sha256: this.validHash,
        isBundled: true,
        fileSizeBytes: 350 * 1024 * 1024,
      };
    }
    public async verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
      return expectedSha256 === this.validHash;
    }
  }

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

    // Seed standard fixture
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
          text: 'The Civil Service Commission is the central personnel agency of the Government.',
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
      ],
      choices: [
        { id: 'c1', question_id: 'q1', choice_key: 'A', text: 'Civil Service Commission', sort_order: 1 },
        { id: 'c2', question_id: 'q1', choice_key: 'B', text: 'Department of Budget and Management', sort_order: 2 },
      ],
      question_answers: [{ question_id: 'q1', canonical_choice_id: 'c1' }],
      question_passages: [
        {
          question_id: 'q1',
          passage_id: 'p1',
          link_type: 'verified',
          confidence: 'verified',
          reviewer_status: 'approved',
        },
      ],
    });
  });

  it('1. InitializeApp: cold starts successfully even when model is missing', async () => {
    const missingLlm = new LocalLlmService({ adapter: mockAdapter, initialState: 'missing' });
    const initApp = new InitializeApp({ db, llmPort: missingLlm, logger });

    const result = await initApp.execute();

    assert.equal(result.isReady, true); // Core review is ready!
    assert.equal(result.contentPackVersion, '2026.10.1');
    assert.equal(result.modelStatus.state, 'missing');
    assert.equal(result.activeTopicCount, 1);
  });

  it('2. GetNextQuestion: returns questions with seeded deterministic shuffling', async () => {
    const useCase = new GetNextQuestion({ repository: questionRepo });
    const questions = await useCase.execute({
      query: { mode: 'all' },
      sessionSeed: 'exam-seed-999',
      shuffleChoices: true,
    });

    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.choices.length, 2);
  });

  it('3. SubmitAnswer: scores deterministically and records attempt atomically', async () => {
    const useCase = new SubmitAnswer(questionRepo);
    const result = await useCase.execute({
      questionId: 'q1',
      selectedChoiceId: 'c1',
      durationMs: 3200,
    });

    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.canonicalChoiceId, 'c1');
    assert.ok(result.attempt.id);

    // Verify stored attempt
    const attempts = await db.query('SELECT * FROM answer_attempts WHERE question_id = ?', ['q1']);
    assert.equal(attempts.length, 1);
  });

  it('4. GetExplanationContext: retrieves canonical explanation and linked passages with source pages', async () => {
    const useCase = new GetExplanationContext(questionRepo, passageRetriever);
    const context = await useCase.execute('q1');

    assert.ok(context.canonicalExplanation?.includes('Article IX-B'));
    assert.equal(context.passages.length, 1);
    assert.equal(context.passages[0]?.passage.id, 'p1');
    assert.ok(context.sourcePages.includes(25));
  });

  it('5. ExplainMore: generates bounded pedagogical explanation citing textbook pages', async () => {
    mockAdapter.setResponses([
      'According to page 25 of the textbook, the Civil Service Commission is established as the central personnel agency.',
    ]);
    const useCase = new ExplainMore(questionRepo, passageRetriever, llmService, logger);

    const response = await useCase.execute({ questionId: 'q1' });

    assert.ok(response.explanation.includes('Civil Service Commission'));
    assert.ok(response.sourcePages.includes(25));
    assert.deepEqual(response.retrievedPassageIds, ['p1']);

    // Check debug trace in logger
    const traces = logger.getTraces();
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.questionId, 'q1');
    assert.equal(traces[0]?.status, 'completed');
  });

  it('6. InterpretFreeAnswer: evaluates semantic response with JSON schema and guardrails', async () => {
    const validVerdictJson = JSON.stringify({
      verdict: 'equivalent',
      matched_concepts: ['central personnel agency'],
      missing_concepts: [],
      evidence_passage_ids: ['p1'],
      confidence: 0.94,
    });
    mockAdapter.setResponses([validVerdictJson]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);
    const response = await useCase.execute({
      questionId: 'q1',
      studentAnswer: 'The central personnel body of government is the Civil Service Commission.',
    });

    assert.equal(response.verdict.verdict, 'equivalent');
    assert.equal(response.verdict.isCorrect, true);
    assert.equal(response.verdict.score, 1.0);
    assert.equal(response.verdict.guardrailTriggered, null);
  });

  it('7. CancelGeneration: safely aborts active generation via AbortController', () => {
    const useCase = new CancelGeneration(logger);
    const controller = new AbortController();

    const cancelled = useCase.execute({ controller, runId: 'run-to-cancel' });
    assert.equal(cancelled, true);
    assert.equal(controller.signal.aborted, true);

    // Calling cancel on already aborted controller returns false
    const secondCancel = useCase.execute({ controller });
    assert.equal(secondCancel, false);
  });

  it('8. CheckModelReadiness: verifies manifest existence and SHA-256 integrity from missing state', async () => {
    const assetStore = new FakeAssetStore();
    const missingLlm = new LocalLlmService({ adapter: mockAdapter, initialState: 'missing' });
    const useCase = new CheckModelReadiness(assetStore, missingLlm, logger);

    const result = await useCase.execute('qwen-0.5b-q4');
    assert.equal(result.isReady, true);
    assert.equal(result.status.state, 'ready');
    assert.equal(result.checksumVerified, true);
    assert.equal(result.asset?.modelName, 'model.gguf');
  });

  it('9. ExportDiagnostics: includes attached metadata and redacts prompt/student input', async () => {
    // Log an event with sensitive and non-sensitive fields
    logger.info('test', 'Diagnostic check', {
      prompt: 'Secret prompt content that should never be in exported bundle',
      userAnswer: 'Student private answer text',
      modelId: 'qwen-0.5b',
    });

    const useCase = new ExportDiagnostics({ logger, db, llmPort: llmService, appVersion: '0.1.0' });
    const result = await useCase.execute();

    assert.equal(result.bundle.appVersion, '0.1.0');
    assert.ok(result.jsonString.includes('[REDACTED_PRIVACY]'));
    assert.ok(!result.jsonString.includes('Secret prompt content'));
    assert.ok(!result.jsonString.includes('Student private answer text'));
    assert.ok(result.jsonString.includes('qwen-0.5b'));
    // Verify that content pack version and model status are now captured in export!
    assert.ok(result.jsonString.includes('2026.10.1'));
    assert.ok(result.jsonString.includes('ready'));
  });

  it('SubmitAnswer: resolves freeTextAnswer to multiple choice key when selectedChoiceId is omitted', async () => {
    const useCase = new SubmitAnswer(questionRepo);
    // Student answered by typing choice key 'A' instead of clicking choice ID 'c1'
    const result = await useCase.execute({
      questionId: 'q1',
      freeTextAnswer: 'A',
      durationMs: 1500,
    });

    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.attempt.selectedChoiceId, 'c1');
    assert.equal(result.canonicalAnswer, 'A');
  });

  it('GetNextQuestion: does not shuffle choices when question contains positional options', async () => {
    // Add question with "All of the above"
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
          id: 'q_pos',
          topic_id: 't1',
          question_type: 'multiple_choice',
          stem: 'Which are constitutional commissions?',
          source_page: 30,
          content_version: '2026.10.1',
        },
      ],
      choices: [
        { id: 'c1', question_id: 'q_pos', choice_key: 'A', text: 'CSC', sort_order: 1 },
        { id: 'c2', question_id: 'q_pos', choice_key: 'B', text: 'COMELEC', sort_order: 2 },
        { id: 'c3', question_id: 'q_pos', choice_key: 'C', text: 'COA', sort_order: 3 },
        { id: 'c4', question_id: 'q_pos', choice_key: 'D', text: 'All of the above', sort_order: 4 },
      ],
      question_answers: [{ question_id: 'q_pos', canonical_choice_id: 'c4' }],
      question_passages: [],
    });

    const useCase = new GetNextQuestion({ repository: questionRepo });
    const questions = await useCase.execute({
      query: { mode: 'all' },
      sessionSeed: 'any-random-seed',
      shuffleChoices: true,
    });

    const posQ = questions.find((q) => q.id === 'q_pos');
    assert.ok(posQ);
    // Choices order MUST remain in original sort_order (1, 2, 3, 4) because shuffling is not permitted
    assert.equal(posQ!.choices[3]?.text, 'All of the above');
    assert.equal(posQ!.choices[0]?.text, 'CSC');
  });
});

