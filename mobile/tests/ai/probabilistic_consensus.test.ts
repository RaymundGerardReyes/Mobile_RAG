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
import {
  GenerationChunk,
  GenerationRequest,
  LocalLlmPort,
  ModelRuntimeStatus,
} from '../../src/application/ports/local_llm_port.js';
import { InterpretFreeAnswer } from '../../src/application/use_cases/interpret_free_answer.js';
import {
  RETRIEVAL_TIER_CONFIG,
  RetrievalTier,
} from '../../src/application/ports/passage_retriever.js';
import { colors } from '../../src/theme/tokens.js';

// ============================================================================
// Helpers: WCAG Luminance & Contrast Ratio
// ============================================================================

function getLuminance(hex: string): number {
  const rgb = hex.replace('#', '');
  const r = parseInt(rgb.substring(0, 2), 16) / 255;
  const g = parseInt(rgb.substring(2, 4), 16) / 255;
  const b = parseInt(rgb.substring(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// ============================================================================
// Queue Mock LLM Port for Multi-Sample Consensus Tests
// ============================================================================

class QueueMockLlmPort implements LocalLlmPort {
  private queue: string[];
  private currentIndex = 0;
  public callCount = 0;
  public activeGenerations = 0;
  public maxConcurrentSeen = 0;

  constructor(responses: string[]) {
    this.queue = responses;
  }

  public setQueue(responses: string[]): void {
    this.queue = responses;
    this.currentIndex = 0;
  }

  public async getStatus(): Promise<ModelRuntimeStatus> {
    return { state: 'loaded', manifestId: 'mock-llm-consensus' };
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

    if (signal?.aborted) {
      this.activeGenerations--;
      const err = new Error('Generation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    const textToEmit =
      this.queue[this.currentIndex] ??
      this.queue[this.queue.length - 1] ??
      '{"verdict":"equivalent","matched_concepts":[],"missing_concepts":[],"evidence_passage_ids":[],"confidence":0.9}';

    this.currentIndex++;

    try {
      yield { text: textToEmit, isComplete: true };
    } finally {
      this.activeGenerations--;
    }
  }
}

// ============================================================================
// Test Suite 1: InterpretFreeAnswer.executeConsensus()
// ============================================================================

describe('AI Evaluation: InterpretFreeAnswer.executeConsensus()', () => {
  let db: NodeSqliteDatabase;
  let questionRepo: SqliteQuestionRepository;
  let passageRetriever: SqlitePassageRetriever;
  let importer: ContentPackImporter;
  let logger: DiagnosticsLogger;

  beforeEach(async () => {
    db = new NodeSqliteDatabase(':memory:');
    await db.execute(INITIAL_SCHEMA_SQL);
    logger = new DiagnosticsLogger(50);
    logger.clear();

    importer = new ContentPackImporter(db, logger);
    questionRepo = new SqliteQuestionRepository(db);
    passageRetriever = new SqlitePassageRetriever(db);

    // Seed standard test question and linked passage
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

  it('1. samples default N=3 stochastic evaluations and returns valid ConsensusEvaluationBreakdown', async () => {
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: ['Civil Service Commission'],
        missing_concepts: [],
        evidence_passage_ids: ['p1'],
        confidence: 0.92,
      }),
      JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: ['Civil Service Commission'],
        missing_concepts: [],
        evidence_passage_ids: ['p1'],
        confidence: 0.88,
      }),
      JSON.stringify({
        verdict: 'partially_equivalent',
        matched_concepts: ['Civil Service Commission'],
        missing_concepts: ['merit and fitness'],
        evidence_passage_ids: ['p1'],
        confidence: 0.84,
      }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus(
      'q1',
      'The Civil Service Commission is the central body.'
    );

    assert.equal(breakdown.numSamples, 3);
    assert.equal(breakdown.samples.length, 3);
    assert.equal(breakdown.questionId, 'q1');
    assert.equal(breakdown.studentAnswer, 'The Civil Service Commission is the central body.');
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.verdictDistribution.equivalent, 2);
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 1);
    assert.equal(breakdown.verdictDistribution.incorrect, 0);
    assert.equal(breakdown.verdictDistribution.ambiguous, 0);
    assert.equal(Math.round(breakdown.agreementRate * 100), 67); // 2/3 agreement
    assert.ok(Math.abs(breakdown.averageConfidence - 0.88) < 0.001);
    assert.equal(breakdown.winningEvaluation.verdict, 'equivalent');
    assert.equal(breakdown.winningEvaluation.confidence, 0.92);
    assert.equal(breakdown.guardrailSummary.allPassed, true);
    assert.equal(breakdown.guardrailSummary.passedCount, 3);
    assert.equal(queuePort.callCount, 3);
  });

  it('2. supports custom numSamples (N=5)', async () => {
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'CSC', 5);

    assert.equal(breakdown.numSamples, 5);
    assert.equal(breakdown.samples.length, 5);
    assert.equal(queuePort.callCount, 5);
    assert.equal(breakdown.agreementRate, 1.0);
  });

  it('3. executes sequentially through LocalLlmService without triggering CONCURRENT_GENERATION_NOT_ALLOWED', async () => {
    const mockAdapter = new MockLocalLlmAdapter({
      responses: [
        JSON.stringify({
          verdict: 'equivalent',
          matched_concepts: ['Civil Service Commission'],
          missing_concepts: [],
          evidence_passage_ids: ['p1'],
          confidence: 0.95,
        }),
      ],
      chunkDelayMs: 2,
    });

    const llmService = new LocalLlmService({ adapter: mockAdapter, logger });
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, llmService, logger);

    // LocalLlmService enforces strict single-active-generation state machine.
    // If executeConsensus ran via Promise.all(), it would throw CONCURRENT_GENERATION_NOT_ALLOWED.
    const breakdown = await useCase.executeConsensus('q1', 'Civil Service Commission', 3);

    assert.equal(breakdown.numSamples, 3);
    assert.equal(breakdown.samples.length, 3);
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.guardrailSummary.allPassed, true);
  });

  it('4. calculates unanimous consensus (3/3 equivalent, agreementRate: 1.0)', async () => {
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: ['A'], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.96 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: ['A'], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.94 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: ['A'], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.92 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'CSC');

    assert.equal(breakdown.verdictDistribution.equivalent, 3);
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.agreementRate, 1.0);
    assert.equal(breakdown.winningEvaluation.confidence, 0.96);
    assert.equal(breakdown.guardrailSummary.allPassed, true);
  });

  it('5. resolves 3-way vote tie using highest aggregate confidence', async () => {
    // 1-1-1 split vote: equivalent vs partially_equivalent vs incorrect
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.92 }),
      JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.85 }),
      JSON.stringify({ verdict: 'incorrect', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.78 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Ambiguous answer');

    assert.equal(breakdown.verdictDistribution.equivalent, 1);
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 1);
    assert.equal(breakdown.verdictDistribution.incorrect, 1);
    // Highest aggregate confidence is equivalent (0.92 > 0.85 > 0.78)
    assert.equal(breakdown.winningVerdict, 'equivalent');
    assert.equal(breakdown.winningEvaluation.verdict, 'equivalent');
    assert.equal(breakdown.winningEvaluation.confidence, 0.92);
  });

  it('6. resolves 2-way tie (N=4, 2 vs 2) using aggregate confidence sums', async () => {
    // 2 equivalent (conf 0.76, 0.78 => sum 1.54) vs 2 partially_equivalent (conf 0.90, 0.92 => sum 1.82)
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.76 }),
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.78 }),
      JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.90 }),
      JSON.stringify({ verdict: 'partially_equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.92 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Partial answer', 4);

    assert.equal(breakdown.verdictDistribution.equivalent, 2);
    assert.equal(breakdown.verdictDistribution.partially_equivalent, 2);
    // partially_equivalent aggregate (1.82) > equivalent aggregate (1.54)
    assert.equal(breakdown.winningVerdict, 'partially_equivalent');
    assert.equal(breakdown.winningEvaluation.verdict, 'partially_equivalent');
    assert.equal(breakdown.winningEvaluation.confidence, 0.92);
  });

  it('7. applies deterministic fallback priority when tie votes have identical confidence sums', async () => {
    // 1 equivalent @ 0.85 vs 1 incorrect @ 0.85
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.85 }),
      JSON.stringify({ verdict: 'incorrect', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.85 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Test', 2);

    assert.equal(breakdown.winningVerdict, 'equivalent');
  });

  it('8. aggregates 4-tier guardrail triggers across stochastic samples', async () => {
    const queuePort = new QueueMockLlmPort([
      // Sample 1: Malformed JSON
      'Invalid non-json output from local model',
      // Sample 2: Hallucinated evidence passage ID
      JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: [],
        missing_concepts: [],
        evidence_passage_ids: ['hallucinated_p99'],
        confidence: 0.9,
      }),
      // Sample 3: Low confidence (< 0.75)
      JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: [],
        missing_concepts: [],
        evidence_passage_ids: ['p1'],
        confidence: 0.55,
      }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const breakdown = await useCase.executeConsensus('q1', 'Raw text');

    assert.equal(breakdown.guardrailSummary.malformedJsonCount, 1);
    assert.equal(breakdown.guardrailSummary.hallucinatedEvidenceCount, 1);
    assert.equal(breakdown.guardrailSummary.lowConfidenceCount, 1);
    assert.equal(breakdown.guardrailSummary.passedCount, 0);
    assert.equal(breakdown.guardrailSummary.allPassed, false);
  });

  it('9. handles cancellation cleanly via AbortSignal', async () => {
    const queuePort = new QueueMockLlmPort([
      JSON.stringify({ verdict: 'equivalent', matched_concepts: [], missing_concepts: [], evidence_passage_ids: ['p1'], confidence: 0.9 }),
    ]);

    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await useCase.executeConsensus('q1', 'Answer', 3, controller.signal);
      },
      (err: any) => err.name === 'AbortError'
    );
  });

  it('10. throws Error on non-existent questionId', async () => {
    const queuePort = new QueueMockLlmPort([]);
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);

    await assert.rejects(
      async () => {
        await useCase.executeConsensus('non_existent_id', 'Answer');
      },
      /Question not found: non_existent_id/
    );
  });

  it('11. throws Error on invalid numSamples (<= 0)', async () => {
    const queuePort = new QueueMockLlmPort([]);
    const useCase = new InterpretFreeAnswer(questionRepo, passageRetriever, queuePort, logger);

    await assert.rejects(
      async () => {
        await useCase.executeConsensus('q1', 'Answer', 0);
      },
      /numSamples must be at least 1/
    );
  });
});

// ============================================================================
// Test Suite 2: Probabilistic UI Primitives: RetrievalTierBadge & WCAG Contrast
// ============================================================================

describe('Probabilistic UI Primitives: RetrievalTierBadge Mappings & WCAG Contrast', () => {
  const tiers: RetrievalTier[] = [
    'tier1_direct',
    'tier2_strict_and',
    'tier3_broad_or',
    'linked',
    'fts5',
  ];

  it('1. provides complete metadata configuration for all 5 retrieval tiers', () => {
    for (const tier of tiers) {
      const config = RETRIEVAL_TIER_CONFIG[tier];
      assert.ok(config, `Missing configuration for tier: ${tier}`);
      assert.ok(config.label.length > 0, `Missing label for tier: ${tier}`);
      assert.ok(config.shortLabel.length > 0, `Missing shortLabel for tier: ${tier}`);
      assert.ok(config.description.length > 0, `Missing description for tier: ${tier}`);
      assert.ok(config.textColor.startsWith('#'), `Invalid textColor for tier: ${tier}`);
      assert.ok(config.backgroundColor.startsWith('#'), `Invalid backgroundColor for tier: ${tier}`);
      assert.ok(config.borderColor.startsWith('#'), `Invalid borderColor for tier: ${tier}`);
      assert.ok(config.dotColor.startsWith('#'), `Invalid dotColor for tier: ${tier}`);
    }
  });

  it('2. verifies Tier 1 (tier1_direct & linked) satisfies WCAG AA contrast (>= 4.5:1)', () => {
    const t1 = RETRIEVAL_TIER_CONFIG.tier1_direct;
    const ratioT1 = getContrastRatio(t1.textColor, t1.backgroundColor);
    assert.ok(
      ratioT1 >= 4.5,
      `tier1_direct contrast ratio ${ratioT1.toFixed(2)} must be >= 4.5:1`
    );

    const linked = RETRIEVAL_TIER_CONFIG.linked;
    const ratioLinked = getContrastRatio(linked.textColor, linked.backgroundColor);
    assert.ok(
      ratioLinked >= 4.5,
      `linked contrast ratio ${ratioLinked.toFixed(2)} must be >= 4.5:1`
    );
  });

  it('3. verifies Tier 2 (tier2_strict_and) satisfies WCAG AAA contrast (>= 7.0:1)', () => {
    const t2 = RETRIEVAL_TIER_CONFIG.tier2_strict_and;
    const ratio = getContrastRatio(t2.textColor, t2.backgroundColor);
    assert.ok(
      ratio >= 7.0,
      `tier2_strict_and contrast ratio ${ratio.toFixed(2)} must be >= 7.0:1 (WCAG AAA)`
    );
  });

  it('4. verifies Tier 3 (tier3_broad_or) satisfies WCAG AA contrast (>= 4.5:1)', () => {
    const t3 = RETRIEVAL_TIER_CONFIG.tier3_broad_or;
    const ratio = getContrastRatio(t3.textColor, t3.backgroundColor);
    assert.ok(
      ratio >= 4.5,
      `tier3_broad_or contrast ratio ${ratio.toFixed(2)} must be >= 4.5:1`
    );
  });

  it('5. verifies FTS5 BM25 satisfies WCAG AAA contrast (>= 7.0:1)', () => {
    const fts5 = RETRIEVAL_TIER_CONFIG.fts5;
    const ratio = getContrastRatio(fts5.textColor, fts5.backgroundColor);
    assert.ok(
      ratio >= 7.0,
      `fts5 contrast ratio ${ratio.toFixed(2)} must be >= 7.0:1 (WCAG AAA)`
    );
  });

  it('6. verifies indicator dot colors match status semantics', () => {
    assert.equal(RETRIEVAL_TIER_CONFIG.tier1_direct.dotColor, colors.semantic.correct.text);
    assert.equal(RETRIEVAL_TIER_CONFIG.tier2_strict_and.dotColor, colors.brand.primary);
    assert.equal(RETRIEVAL_TIER_CONFIG.tier3_broad_or.dotColor, colors.semantic.warning.text);
    assert.equal(RETRIEVAL_TIER_CONFIG.linked.dotColor, colors.semantic.correct.text);
    assert.equal(RETRIEVAL_TIER_CONFIG.fts5.dotColor, colors.neutral.textSecondary);
  });
});
