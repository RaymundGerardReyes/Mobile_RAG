import { QuestionRepository } from '../ports/question_repository.js';
import { PassageRetriever } from '../ports/passage_retriever.js';
import { LocalLlmPort } from '../ports/local_llm_port.js';
import { PromptBuilder } from '../../ai/prompting/prompt_builder.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface ExplainMoreRequest {
  questionId: string;
  language?: 'en' | 'fil';
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export interface ExplainMoreResponse {
  runId: string;
  explanation: string;
  sourcePages: number[];
  retrievedPassageIds: string[];
  durationMs: number;
  promptVersion: string;
}

export class ExplainMore {
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

  public async execute(request: ExplainMoreRequest): Promise<ExplainMoreResponse> {
    const startTime = Date.now();
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const question = await this.questionRepo.getQuestionById(request.questionId);
    if (!question) {
      throw new Error(`Question not found: ${request.questionId}`);
    }

    // Determine canonical answer text
    let canonicalText = question.canonicalAnswer || '';
    if (!canonicalText && question.canonicalChoiceId) {
      const choice = question.choices.find((c) => c.id === question.canonicalChoiceId);
      if (choice) {
        canonicalText = `[Choice ${choice.choiceKey}] ${choice.text}`;
      }
    }

    // Retrieve supporting passages
    const passages = await this.passageRetriever.retrieveForQuestion(
      question.id,
      question.stem,
      3
    );

    // Build bounded prompt (max 1024 tokens)
    const builtPrompt = PromptBuilder.buildPrompt({
      question,
      canonicalAnswerText: canonicalText,
      canonicalExplanation: question.canonicalExplanation,
      supportingPassages: passages,
      language: request.language ?? 'en',
      task: 'explain',
    });

    let fullExplanation = '';
    let tokenCount = 0;

    try {
      for await (const chunk of this.llmPort.generate(
        {
          prompt: builtPrompt.prompt,
          maxTokens: 512,
          temperature: 0.2,
        },
        request.signal
      )) {
        fullExplanation += chunk.text;
        tokenCount++;
        request.onChunk?.(chunk.text);
      }

      const durationMs = Date.now() - startTime;

      // Extract unique source pages
      const sourcePages = new Set<number>();
      if (question.sourcePage) sourcePages.add(question.sourcePage);
      for (const p of passages) {
        sourcePages.add(p.passage.startPage);
        if (p.passage.endPage && p.passage.endPage !== p.passage.startPage) {
          sourcePages.add(p.passage.endPage);
        }
      }

      this.logger.recordTrace({
        runId,
        questionId: question.id,
        contentPackVersion: question.contentVersion,
        retrievalStrategy: passages.some((p) => p.strategy === 'linked') ? 'linked_then_fts5' : 'fts5',
        retrievedPassageIds: builtPrompt.includedPassageIds,
        modelManifestId: (await this.llmPort.getStatus()).manifestId || 'unknown',
        promptTemplateVersion: builtPrompt.promptVersion,
        durationMs,
        status: 'completed',
        errorCode: null,
        emittedTokenCount: tokenCount,
      });

      return {
        runId,
        explanation: fullExplanation.trim(),
        sourcePages: Array.from(sourcePages).sort((a, b) => a - b),
        retrievedPassageIds: builtPrompt.includedPassageIds,
        durationMs,
        promptVersion: builtPrompt.promptVersion,
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
        emittedTokenCount: tokenCount,
      });

      throw err;
    }
  }
}

