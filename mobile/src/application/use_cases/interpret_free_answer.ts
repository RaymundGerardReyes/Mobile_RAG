import { QuestionRepository } from '../ports/question_repository.js';
import { PassageRetriever } from '../ports/passage_retriever.js';
import { LocalLlmPort } from '../ports/local_llm_port.js';
import { PromptBuilder } from '../../ai/prompting/prompt_builder.js';
import {
  FreeAnswerVerdictType,
  OutputValidator,
  ValidatedVerdictResult,
} from '../../ai/evaluation/output_validator.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface InterpretFreeAnswerRequest {
  questionId: string;
  studentAnswer: string;
  signal?: AbortSignal;
}

export interface InterpretFreeAnswerResponse {
  runId: string;
  questionId: string;
  verdict: ValidatedVerdictResult;
  durationMs: number;
}

export interface ConsensusGuardrailSummary {
  malformedJsonCount: number;
  hallucinatedEvidenceCount: number;
  lowConfidenceCount: number;
  passedCount: number;
  allPassed: boolean;
}

export interface ConsensusEvaluationBreakdown {
  runId: string;
  questionId: string;
  studentAnswer: string;
  numSamples: number;
  samples: ValidatedVerdictResult[];
  verdictDistribution: Record<FreeAnswerVerdictType, number>;
  winningVerdict: FreeAnswerVerdictType;
  averageConfidence: number;
  agreementRate: number;
  winningEvaluation: ValidatedVerdictResult;
  guardrailSummary: ConsensusGuardrailSummary;
  durationMs: number;
}

export class InterpretFreeAnswer {
  private questionRepo: QuestionRepository;
  private passageRetriever: PassageRetriever;
  private llmPort: LocalLlmPort;
  private logger: DiagnosticsLogger;

  constructor(
    questionRepo: QuestionRepository,
    passageRetriever: PassageRetriever,
    llmPort: LocalLlmPort,
    logger?: DiagnosticsLogger
  ) {
    this.questionRepo = questionRepo;
    this.passageRetriever = passageRetriever;
    this.llmPort = llmPort;
    this.logger = logger ?? DiagnosticsLogger.getInstance();
  }

  public async execute(
    request: InterpretFreeAnswerRequest
  ): Promise<InterpretFreeAnswerResponse> {
    const startTime = Date.now();
    const runId = `run_eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const question = await this.questionRepo.getQuestionById(request.questionId);
    if (!question) {
      throw new Error(`Question not found: ${request.questionId}`);
    }

    const canonicalText = question.canonicalAnswer || question.canonicalExplanation || '';

    // Retrieve supporting passages
    const passages = await this.passageRetriever.retrieveForQuestion(
      question.id,
      question.stem,
      3
    );

    // Build constrained JSON schema prompt
    const builtPrompt = PromptBuilder.buildPrompt({
      question,
      canonicalAnswerText: canonicalText,
      canonicalExplanation: question.canonicalExplanation,
      supportingPassages: passages,
      studentAnswer: request.studentAnswer,
      task: 'interpret_free_answer',
    });

    let rawJsonOutput = '';

    try {
      for await (const chunk of this.llmPort.generate(
        {
          prompt: builtPrompt.prompt,
          maxTokens: 256,
          temperature: 0.1,
        },
        request.signal
      )) {
        rawJsonOutput += chunk.text;
      }

      // Validate against the 4 scoring guardrails
      const verdict = OutputValidator.validateFreeAnswer(
        rawJsonOutput,
        builtPrompt.includedPassageIds
      );

      const durationMs = Date.now() - startTime;

      this.logger.recordTrace({
        runId,
        questionId: question.id,
        contentPackVersion: question.contentVersion,
        retrievalStrategy: 'linked_then_fts5',
        retrievedPassageIds: builtPrompt.includedPassageIds,
        modelManifestId: (await this.llmPort.getStatus()).manifestId || 'unknown',
        promptTemplateVersion: builtPrompt.promptVersion,
        durationMs,
        status: 'completed',
        errorCode: verdict.guardrailTriggered ?? null,
      });

      return {
        runId,
        questionId: question.id,
        verdict,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isCancelled = request.signal?.aborted || err?.name === 'AbortError';

      this.logger.recordTrace({
        runId,
        questionId: question.id,
        contentPackVersion: question.contentVersion,
        retrievalStrategy: 'linked_then_fts5',
        retrievedPassageIds: builtPrompt.includedPassageIds,
        modelManifestId: 'unknown',
        promptTemplateVersion: builtPrompt.promptVersion,
        durationMs,
        status: isCancelled ? 'cancelled' : 'failed',
        errorCode: isCancelled ? ErrorCodes.LLM_CANCELLED : 'LLM_ERROR',
      });

      throw err;
    }
  }

  /**
   * Evaluates a student's free text answer across N stochastic LLM runs (Best-of-N Consensus).
   *
   * CRITICAL INVARIANT: LocalLlmService enforces CONCURRENT_GENERATION_NOT_ALLOWED.
   * Generation MUST run sequentially in a loop, NOT Promise.all().
   */
  public async executeConsensus(
    questionId: string,
    studentAnswer: string,
    numSamples = 3,
    signal?: AbortSignal
  ): Promise<ConsensusEvaluationBreakdown> {
    if (numSamples <= 0) {
      throw new Error('numSamples must be at least 1');
    }

    const startTime = Date.now();
    const runId = `run_consensus_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const question = await this.questionRepo.getQuestionById(questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const canonicalText = question.canonicalAnswer || question.canonicalExplanation || '';

    // Retrieve supporting passages once for all samples
    const passages = await this.passageRetriever.retrieveForQuestion(
      question.id,
      question.stem,
      3
    );

    // Build constrained JSON schema prompt once before the loop
    const builtPrompt = PromptBuilder.buildPrompt({
      question,
      canonicalAnswerText: canonicalText,
      canonicalExplanation: question.canonicalExplanation,
      supportingPassages: passages,
      studentAnswer,
      task: 'interpret_free_answer',
    });

    const samples: ValidatedVerdictResult[] = [];

    try {
      // Sequential LLM execution satisfying single-generation concurrency guardrail
      for (let i = 0; i < numSamples; i++) {
        if (signal?.aborted) {
          const abortErr = new Error('Generation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        let rawJsonOutput = '';
        for await (const chunk of this.llmPort.generate(
          {
            prompt: builtPrompt.prompt,
            maxTokens: 256,
            temperature: 0.7,
          },
          signal
        )) {
          rawJsonOutput += chunk.text;
        }

        // Validate sample output against the 4 scoring guardrails
        const sampleResult = OutputValidator.validateFreeAnswer(
          rawJsonOutput,
          builtPrompt.includedPassageIds
        );
        samples.push(sampleResult);
      }

      // Compute verdict distribution across all 4 verdict types
      const verdictDistribution: Record<FreeAnswerVerdictType, number> = {
        equivalent: 0,
        partially_equivalent: 0,
        incorrect: 0,
        ambiguous: 0,
      };

      for (const sample of samples) {
        verdictDistribution[sample.verdict]++;
      }

      // Determine majority winning verdict with confidence-weighted tie-breaking
      const allVerdicts: FreeAnswerVerdictType[] = [
        'equivalent',
        'partially_equivalent',
        'incorrect',
        'ambiguous',
      ];
      let maxVotes = -1;
      for (const v of allVerdicts) {
        if (verdictDistribution[v] > maxVotes) {
          maxVotes = verdictDistribution[v];
        }
      }

      const tiedCandidates = allVerdicts.filter((v) => verdictDistribution[v] === maxVotes);

      let winningVerdict: FreeAnswerVerdictType;
      if (tiedCandidates.length === 1) {
        winningVerdict = tiedCandidates[0]!;
      } else {
        // Aggregate confidence for tied verdicts
        const aggregateConfidences = new Map<FreeAnswerVerdictType, number>();
        const maxConfidences = new Map<FreeAnswerVerdictType, number>();

        for (const candidate of tiedCandidates) {
          const matchingSamples = samples.filter((s) => s.verdict === candidate);
          const totalConf = matchingSamples.reduce((sum, s) => sum + s.confidence, 0);
          const maxConf = Math.max(...matchingSamples.map((s) => s.confidence));
          aggregateConfidences.set(candidate, totalConf);
          maxConfidences.set(candidate, maxConf);
        }

        tiedCandidates.sort((a, b) => {
          const diffAgg = (aggregateConfidences.get(b) ?? 0) - (aggregateConfidences.get(a) ?? 0);
          if (Math.abs(diffAgg) > 1e-6) return diffAgg;

          const diffMax = (maxConfidences.get(b) ?? 0) - (maxConfidences.get(a) ?? 0);
          if (Math.abs(diffMax) > 1e-6) return diffMax;

          const priority: Record<FreeAnswerVerdictType, number> = {
            equivalent: 4,
            partially_equivalent: 3,
            incorrect: 2,
            ambiguous: 1,
          };
          return priority[b] - priority[a];
        });

        winningVerdict = tiedCandidates[0]!;
      }

      // Compute average confidence
      const averageConfidence =
        samples.length > 0
          ? samples.reduce((acc, s) => acc + s.confidence, 0) / samples.length
          : 0;

      // Agreement rate = winning verdict count / total samples
      const agreementRate =
        samples.length > 0 ? verdictDistribution[winningVerdict] / samples.length : 0;

      // Winning evaluation: highest-confidence sample from the winning verdict group
      const winningSamples = samples.filter((s) => s.verdict === winningVerdict);
      const winningEvaluation =
        winningSamples.sort((a, b) => b.confidence - a.confidence)[0] ?? samples[0]!;

      // 4-tier guardrail aggregation
      let malformedJsonCount = 0;
      let hallucinatedEvidenceCount = 0;
      let lowConfidenceCount = 0;
      let passedCount = 0;

      for (const sample of samples) {
        if (sample.guardrailTriggered === 'MALFORMED_JSON') {
          malformedJsonCount++;
        } else if (sample.guardrailTriggered === 'HALLUCINATED_EVIDENCE') {
          hallucinatedEvidenceCount++;
        } else if (sample.guardrailTriggered === 'LOW_CONFIDENCE') {
          lowConfidenceCount++;
        } else {
          passedCount++;
        }
      }

      const allPassed =
        malformedJsonCount === 0 && hallucinatedEvidenceCount === 0 && lowConfidenceCount === 0;

      const guardrailSummary: ConsensusGuardrailSummary = {
        malformedJsonCount,
        hallucinatedEvidenceCount,
        lowConfidenceCount,
        passedCount,
        allPassed,
      };

      const durationMs = Date.now() - startTime;

      this.logger.recordTrace({
        runId,
        questionId: question.id,
        contentPackVersion: question.contentVersion,
        retrievalStrategy: 'linked_then_fts5',
        retrievedPassageIds: builtPrompt.includedPassageIds,
        modelManifestId: (await this.llmPort.getStatus()).manifestId || 'unknown',
        promptTemplateVersion: builtPrompt.promptVersion,
        durationMs,
        status: 'completed',
        errorCode: guardrailSummary.allPassed ? null : 'GUARDRAIL_TRIGGERED',
      });

      return {
        runId,
        questionId: question.id,
        studentAnswer,
        numSamples,
        samples,
        verdictDistribution,
        winningVerdict,
        averageConfidence,
        agreementRate,
        winningEvaluation,
        guardrailSummary,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isCancelled = signal?.aborted || err?.name === 'AbortError';

      this.logger.recordTrace({
        runId,
        questionId: question.id,
        contentPackVersion: question.contentVersion,
        retrievalStrategy: 'linked_then_fts5',
        retrievedPassageIds: builtPrompt.includedPassageIds,
        modelManifestId: 'unknown',
        promptTemplateVersion: builtPrompt.promptVersion,
        durationMs,
        status: isCancelled ? 'cancelled' : 'failed',
        errorCode: isCancelled ? ErrorCodes.LLM_CANCELLED : 'LLM_ERROR',
      });

      throw err;
    }
  }
}

