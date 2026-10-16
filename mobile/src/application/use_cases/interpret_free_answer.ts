import { QuestionRepository } from '../ports/question_repository.js';
import { PassageRetriever } from '../ports/passage_retriever.js';
import { LocalLlmPort } from '../ports/local_llm_port.js';
import { PromptBuilder } from '../../ai/prompting/prompt_builder.js';
import { OutputValidator, ValidatedVerdictResult } from '../../ai/evaluation/output_validator.js';
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
}

