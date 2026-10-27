import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NodeSqliteDatabase } from '../../src/data/sqlite/sqlite_database.js';
import { INITIAL_SCHEMA_SQL } from '../../src/data/sqlite/schema.js';
import { ContentPackImporter } from '../../src/data/content_pack/content_pack_importer.js';
import { SqliteQuestionRepository } from '../../src/data/sqlite/sqlite_question_repository.js';
import { SqlitePassageRetriever } from '../../src/data/sqlite/sqlite_passage_retriever.js';
import { MockLocalLlmAdapter } from '../../src/ai/runtime/mock_local_llm_adapter.js';
import { LocalLlmService } from '../../src/ai/runtime/local_llm_service.js';
import { DiagnosticsLogger, ErrorCodes } from '../../src/diagnostics/diagnostics_logger.js';
import {
  GenerationChunk,
  GenerationRequest,
  LocalLlmPort,
  ModelRuntimeStatus,
} from '../../src/application/ports/local_llm_port.js';
import { InterpretFreeAnswer } from '../../src/application/use_cases/interpret_free_answer.js';

// ============================================================================
// Adversarial Mock LLM Port with Concurrency and Stream Tracking
// ============================================================================

interface MockSampleBehavior {
  chunks?: string[];
  rawText?: string;
  delayMs?: number;
  throwError?: Error;
  abortDuringStream?: boolean;
}

class AdversarialMockLlmPort implements LocalLlmPort {
  private behaviors: MockSampleBehavior[];
  private currentIndex = 0;
  public callCount = 0;
  public activeGenerations = 0;
  public maxConcurrentSeen = 0;

  constructor(behaviors: MockSampleBehavior[] = []) {
    this.behaviors = behaviors;
  }

  public setBehaviors(behaviors: MockSampleBehavior[]): void {
    this.behaviors = behaviors;
    this.currentIndex = 0;
  }

  public async getStatus(): Promise<ModelRuntimeStatus> {
    return { state: 'loaded', manifestId: 'adversarial-mock-llm' };
  }

  public async load(): Promise<void> {}
  public async release(): Promise<void> {}

  public async *generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): AsyncIterable<GenerationChunk> {
    this.activeGenerations++;
    this.maxConcurrentSeen = Math.max(this.maxConcurrentSeen, this.activeGenerations);
    this.callCount++;

    const behavior = this.behaviors[this.currentIndex] ?? {
      rawText: JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: [],
        missing_concepts: [],
        evidence_passage_ids: ['p1'],
        confidence: 0.9,
      }),
    };
    this.currentIndex++;

    try {
      if (signal?.aborted) {
        const err = new Error('Generation was aborted');
        err.name = 'AbortError';
        throw err;
      }

      if (behavior.throwError) {
        throw behavior.throwError;
      }

      const chunks = behavior.chunks ?? [behavior.rawText ?? ''];
      for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) {
          const err = new Error('Generation was aborted');
          err.name = 'AbortError';
          throw err;
        }

        if (behavior.delayMs && behavior.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
        }

        if (behavior.abortDuringStream && i === Math.floor(chunks.length / 2)) {
          const err = new Error('Generation stream aborted prematurely');
          err.name = 'AbortError';
          throw err;
        }

        yield { text: chunks[i]!, isComplete: i === chunks.length - 1 };
      }
    } finally {
      this.activeGenerations--;
    }
  }
}

// ============================================================================
// Adversarial Test Harness
// ============================================================================

describe('Adversarial Stress Harness: InterpretFreeAnswer.executeConsensus()', () => {
  let db: NodeSqliteDatabase;
  let questionRepo: SqliteQuestionRepository;
  let passageRetriever: SqlitePassageRetriever;
  let importer: ContentPackImporter;
  let logger: DiagnosticsLogger;

  beforeEach(async () => {
    db = new NodeSqliteDatabase(':memory:');
    await db.execute(INITIAL_SCHEMA_SQL);
    logger = new DiagnosticsLogger(100);
    logger.clear();

    importer = new ContentPackImporter(db, logger);
    questionRepo = new SqliteQuestionRepository(db);
    passageRetriever = new SqlitePassageRetriever(db);

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
          text: 'The Civil Service Commission is the central personnel agency of the Government. Appointments shall be made according to merit and fitness.',
          content_hash: 'hash_p1',
        },
      ],
      questions: [
        {
          id: 'q1',
          topic_id: 't1',
          question_type: 'identification',
          stem: 'What is the central personnel agency of the Philippine government?',
          canonical_explanation: 'Article IX-B Section 3 states that CSC is the central personnel agency.',
          source_page: 25,
          content_version: '2026.10.1',
        },
      ],
      choices: [],
      question_answers: [{ question_id: 'q1', canonical_answer: 'Civil Service Commission' }],
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

  // --------------------------------------------------------------------------
  // Dimension 1: Sample Size Scaling (N = 1, 2, 3, 5, 10)
  // --------------------------------------------------------------------------

  it('D1.1: handles boundary N = 1 (agreementRate 1.0, 1 sample, correct winner)', async () => {
    const port = new AdversarialMockLlmPort([
      {
        rawText: JSON.stringify({
          verdict: 'partially_equivalent',
          matched_concepts: ['agency'],
          missing_concepts: ['merit'],
          evidence_passage_ids: ['p1'],
          confidence: 0.81,
        }),
      },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'CSC is agency', 1);

    assert.equal(breakdown.numSamples, 1);
    assert.equal(breakdown.samples.length, 1);
    assert.equal(breakdown.winningVerdict, 'partially_equivalent');
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 1);
    assert.equal(breakdown.verdictDistribution.equivalent, 0);
    assert.equal(breakdown.agreementRate, 1.0);
    assert.equal(breakdown.averageConfidence, 0.81);
    assert.equal(breakdown.winningEvaluation.confidence, 0.81);
    assert.equal(breakdown.guardrailSummary.passedCount, 1);
    assert.equal(breakdown.guardrailSummary.allPassed, true);
    assert.equal(port.callCount, 1);
  });

  it('D1.2: handles N = 2 with 1-1 tie breaking by higher confidence', async () => {
    const port = new AdversarialMockLlmPort([
      {
        rawText: JSON.stringify({
          verdict: 'equivalent',
          matched_concepts: [],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.76,
        }),
      },
      {
        rawText: JSON.stringify({
          verdict: 'incorrect',
          matched_concepts: [],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.89,
        }),
      },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Some answer', 2);

    assert.equal(breakdown.numSamples, 2);
    assert.equal(breakdown.samples.length, 2);
    assert.equal(breakdown.verdictDistribution.equivalent, 1);
    assert.equal(breakdown.verdictDistribution.incorrect, 1);
    // Aggregate & max confidence of incorrect (0.89) > equivalent (0.76)
    assert.equal(breakdown.winningVerdict, 'incorrect');
    assert.equal(breakdown.agreementRate, 0.5); // 1 / 2
    assert.ok(Math.abs(breakdown.averageConfidence - (0.76 + 0.89) / 2) < 0.001);
  });

  it('D1.3: handles N = 5 with 3-2 split (strict majority ignores lower confidence minority)', async () => {
    // 3 samples vote 'partially_equivalent' @ 0.76 (sum = 2.28)
    // 2 samples vote 'equivalent' @ 0.99 (sum = 1.98, individual max = 0.99)
    // Even though equivalent has higher individual confidence (0.99 vs 0.76),
    // partially_equivalent has 3 votes vs 2 votes! Majority must win.
    const port = new AdversarialMockLlmPort([
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.76 }) },
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.99 }) },
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.76 }) },
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.99 }) },
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.76 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Partial answer', 5);

    assert.equal(breakdown.numSamples, 5);
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 3);
    assert.equal(breakdown.verdictDistribution.equivalent, 2);
    assert.equal(breakdown.winningVerdict, 'partially_equivalent');
    assert.equal(breakdown.agreementRate, 0.6); // 3 / 5
    assert.equal(port.callCount, 5);
  });

  it('D1.4: handles N = 10 sequential samples under stress without concurrency violation', async () => {
    const responses: MockSampleBehavior[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push({
        rawText: JSON.stringify({
          verdict: i < 7 ? 'equivalent' : 'partially_equivalent',
          matched_concepts: ['CSC'],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.8 + (i % 10) * 0.01,
        }),
        delayMs: 2, // Slight delay to test async timing
      });
    }

    const port = new AdversarialMockLlmPort(responses);
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'CSC answer', 10);

    assert.equal(breakdown.numSamples, 10);
    assert.equal(breakdown.samples.length, 10);
    assert.equal(port.callCount, 10);
    assert.equal(port.maxConcurrentSeen, 1, 'Max concurrent generations must never exceed 1');
    assert.equal(breakdown.verdictDistribution.equivalent, 7);
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 3);
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.agreementRate, 0.7);
  });

  // --------------------------------------------------------------------------
  // Dimension 2: Verdict Ties & Multi-Level Tie-Breaking
  // --------------------------------------------------------------------------

  it('D2.1: resolves 2-2 tie where aggregate sums are EQUAL, but max individual confidence differs', async () => {
    // 2 partially_equivalent: [0.80, 0.80] => sum 1.60, max 0.80
    // 2 incorrect: [0.85, 0.75] => sum 1.60, max 0.85
    // Aggregate confidences are both exactly 1.60.
    // Max individual confidence: incorrect (0.85) > partially_equivalent (0.80).
    const port = new AdversarialMockLlmPort([
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'incorrect', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.85 }) },
      { rawText: JSON.stringify({ verdict: 'incorrect', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.75 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Tied answer', 4);

    assert.equal(breakdown.verdictDistribution.partially_equivalent, 2);
    assert.equal(breakdown.verdictDistribution.incorrect, 2);
    assert.equal(breakdown.winningVerdict, 'incorrect');
    assert.equal(breakdown.winningEvaluation.confidence, 0.85);
  });

  it('D2.2: resolves 4-way tie (1-1-1-1) with identical confidences using deterministic priority', async () => {
    // N=4: 1 equivalent, 1 partially_equivalent, 1 incorrect, 1 ambiguous.
    // All confidences = 0.80.
    // Priority order: equivalent (4) > partially_equivalent (3) > incorrect (2) > ambiguous (1).
    const port = new AdversarialMockLlmPort([
      { rawText: JSON.stringify({ verdict: 'ambiguous', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'incorrect', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'All 4 tie', 4);

    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.agreementRate, 0.25);
  });

  it('D2.3: verifies floating point tolerance in aggregate confidence tie-breaking with valid confidences (>= 0.75)', async () => {
    // Candidate A (partially_equivalent): [0.80, 0.85] -> sum 1.65, max 0.85
    // Candidate B (equivalent): [0.825, 0.825] -> sum 1.65, max 0.825
    // diffAgg = 1.65 - 1.65 = 0 <= 1e-6.
    // diffMax = 0.85 - 0.825 = 0.025 > 1e-6.
    // Candidate A (partially_equivalent) has higher max confidence, so it must win!
    const port = new AdversarialMockLlmPort([
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.80 }) },
      { rawText: JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.85 }) },
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.825 }) },
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.825 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Float tie', 4);

    assert.equal(breakdown.winningVerdict, 'partially_equivalent');
  });

  // --------------------------------------------------------------------------
  // Dimension 3: Malformed JSON, Empty Chunks, and Mid-Generation Abort
  // --------------------------------------------------------------------------

  it('D3.1: handles 100% malformed JSON output gracefully without crashing', async () => {
    // LLM outputs non-JSON markdown or garbage for all 3 samples
    const port = new AdversarialMockLlmPort([
      { rawText: 'Here is my explanation without JSON format.' },
      { rawText: '```json\n{"verdict": "truncated' },
      { rawText: '{"verdict":"equivalent"}' }, // Missing required arrays and confidence
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Malformed answer', 3);

    assert.equal(breakdown.numSamples, 3);
    assert.equal(breakdown.verdictDistribution.ambiguous, 3);
    assert.equal(breakdown.winningVerdict, 'ambiguous');
    assert.equal(breakdown.averageConfidence, 0.0);
    assert.equal(breakdown.agreementRate, 1.0);
    assert.equal(breakdown.winningEvaluation.requiresManualReview, true);
    assert.equal(breakdown.guardrailSummary.malformedJsonCount, 3);
    assert.equal(breakdown.guardrailSummary.passedCount, 0);
    assert.equal(breakdown.guardrailSummary.allPassed, false);
  });

  it('D3.2: handles empty chunks / empty stream from LLM generator', async () => {
    // LLM yields empty chunks: ["", ""]
    const port = new AdversarialMockLlmPort([
      { chunks: ['', ''] },
      { chunks: [] }, // 0 chunks yielded
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Empty chunk answer', 3);

    // Samples 1 and 2 produce rawJsonOutput = "", triggering MALFORMED_JSON -> ambiguous (0 conf)
    // Sample 3 produces equivalent (0.9 conf)
    assert.equal(breakdown.verdictDistribution.ambiguous, 2);
    assert.equal(breakdown.verdictDistribution.equivalent, 1);
    assert.equal(breakdown.winningVerdict, 'ambiguous'); // 2 votes vs 1 vote
    assert.equal(breakdown.guardrailSummary.malformedJsonCount, 2);
    assert.equal(breakdown.guardrailSummary.passedCount, 1);
    assert.equal(breakdown.guardrailSummary.allPassed, false);
  });

  it('D3.3: handles mid-generation stream abort via AbortSignal and cleans up', async () => {
    const controller = new AbortController();

    const port = new AdversarialMockLlmPort([
      // Sample 1 succeeds
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }) },
      // Sample 2 aborts midway during streaming
      {
        chunks: ['{"verdict":', ' "equivalent"'],
        delayMs: 10,
        abortDuringStream: true,
      },
      // Sample 3 should never be reached
      { rawText: JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }) },
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, port, logger);

    await assert.rejects(
      async () => {
        await useCase.executeConsensus('q1', 'Student answer', 3, controller.signal);
      },
      (err: any) => err.name === 'AbortError' || err.message.includes('aborted')
    );

    // Ensure sample 3 was never called
    assert.equal(port.callCount, 2);
    assert.equal(port.activeGenerations, 0);
  });

  // --------------------------------------------------------------------------
  // Dimension 4: Concurrency Invariant & Stress Testing with LocalLlmService
  // --------------------------------------------------------------------------

  it('D4.1: executes Best-of-N sequentially through real LocalLlmService without throwing CONCURRENT_GENERATION_NOT_ALLOWED', async () => {
    const mockAdapter = new MockLocalLlmAdapter({
      responses: [
        JSON.stringify({
          verdict: 'equivalent',
          matched_concepts: ['agency'],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.91,
        }),
      ],
      chunkDelayMs: 5,
    });

    const llmService = new LocalLlmService({ adapter: mockAdapter, logger });
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);

    const breakdown = await useCase.executeConsensus('q1', 'Civil Service Commission', 3);

    assert.equal(breakdown.numSamples, 3);
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.verdictDistribution.equivalent, 3);
    assert.equal(breakdown.guardrailSummary.allPassed, true);
  });

  it('D4.2: concurrent calls from TWO different callers to executeConsensus trigger CONCURRENT_GENERATION_NOT_ALLOWED on shared LocalLlmService', async () => {
    // To test concurrent collision between two independent callers:
    // The model must be loaded first so that both calls hit active generation immediately
    const mockAdapter = new MockLocalLlmAdapter({
      responses: [
        '{"verdict":"equivalent","matched_concepts":[],"missing_concepts":[],"evidence_passage_ids":["p1"],"confidence":0.90} extra words to ensure multiple chunks stream with delay',
      ],
      chunkDelayMs: 25,
    });

    const llmService = new LocalLlmService({ adapter: mockAdapter, logger });
    await llmService.load(); // Ensure loaded state
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);

    // Call two executeConsensus concurrently on the same service
    const call1 = useCase.executeConsensus('q1', 'Answer 1', 3);
    const call2 = useCase.executeConsensus('q1', 'Answer 2', 3);

    const results = await Promise.allSettled([call1, call2]);

    const rejected = results.filter((r) => r.status === 'rejected');
    const fulfilled = results.filter((r) => r.status === 'fulfilled');

    // Exactly one caller should be rejected with CONCURRENT_GENERATION_NOT_ALLOWED
    // while the other caller finishes
    assert.ok(rejected.length >= 1, 'At least one concurrent call must be rejected');
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      rejectedReason?.message?.includes(ErrorCodes.CONCURRENT_GENERATION_NOT_ALLOWED) ||
      rejectedReason?.message?.includes('Concurrent model generation is not permitted'),
      `Expected CONCURRENT_GENERATION_NOT_ALLOWED, got: ${rejectedReason?.message}`
    );
  });

  it('D4.3: LocalLlmService recovers cleanly after a rejected concurrent call or error and accepts subsequent executeConsensus', async () => {
    const mockAdapter = new MockLocalLlmAdapter({
      responses: [
        JSON.stringify({
          verdict: 'equivalent',
          matched_concepts: [],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.95,
        }),
      ],
      chunkDelayMs: 2,
    });

    const llmService = new LocalLlmService({ adapter: mockAdapter, logger });
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);

    // Run sequential call 1
    const res1 = await useCase.executeConsensus('q1', 'First sequential run', 2);
    assert.equal(res1.numSamples, 2);

    // Run sequential call 2 immediately after
    const res2 = await useCase.executeConsensus('q1', 'Second sequential run', 2);
    assert.equal(res2.numSamples, 2);
    assert.equal(res2.winningVerdict, 'equivalent');
  });
});
