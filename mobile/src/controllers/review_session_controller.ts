/**
 * ReviewSessionController
 *
 * Composition root state manager that coordinates all 9 core use cases
 * for offline question review sessions. Pure TypeScript — decoupled from
 * React, Expo, and native UI elements.
 */

import { Question, Passage } from '../domain/types.js';
import { QuestionSelectionQuery } from '../application/ports/question_repository.js';
import { RetrievedPassage } from '../application/ports/passage_retriever.js';
import { GetNextQuestion } from '../application/use_cases/get_next_question.js';
import { SubmitAnswer, SubmitAnswerResponse } from '../application/use_cases/submit_answer.js';
import { GetExplanationContext } from '../application/use_cases/get_explanation_context.js';
import { ExplainMore, ExplainMoreResponse } from '../application/use_cases/explain_more.js';
import {
  InterpretFreeAnswer,
  InterpretFreeAnswerResponse,
  ConsensusEvaluationBreakdown,
} from '../application/use_cases/interpret_free_answer.js';
import { CancelGeneration } from '../application/use_cases/cancel_generation.js';
import { ValidatedVerdictResult } from '../ai/evaluation/output_validator.js';
import { DiagnosticsLogger } from '../diagnostics/diagnostics_logger.js';

export interface ReviewSessionDependencies {
  getNextQuestion: GetNextQuestion;
  submitAnswer: SubmitAnswer;
  getExplanationContext: GetExplanationContext;
  explainMore: ExplainMore;
  interpretFreeAnswer: InterpretFreeAnswer;
  cancelGeneration: CancelGeneration;
  logger?: DiagnosticsLogger;
}

export interface ReviewSessionState {
  // Session progression
  sessionId?: string;
  questions: Question[];
  currentIndex: number;
  currentQuestion: Question | null;
  totalQuestions: number;
  isSessionCompleted: boolean;

  // Question interaction
  selectedChoiceId: string | null;
  freeTextInput: string;
  questionStartTimeMs: number;

  // Deterministic submission result
  submissionResult: SubmitAnswerResponse | null;
  isSubmitted: boolean;

  // Grounded context & textbook references
  supportingPassages: RetrievedPassage[];
  sourcePages: number[];

  // Probabilistic AI explanation & evaluation
  isGeneratingAi: boolean;
  aiExplanation: string | null;
  streamingAiText: string;
  freeAnswerEvaluation: ValidatedVerdictResult | null;
  consensusEvaluation: ConsensusEvaluationBreakdown | null;
  aiError: string | null;
}

export interface StartSessionParams {
  query: QuestionSelectionQuery;
  sessionId?: string;
  sessionSeed?: string;
  shuffleChoices?: boolean;
}

export type ReviewSessionListener = (state: ReviewSessionState) => void;

export class ReviewSessionController {
  private deps: ReviewSessionDependencies;
  private state: ReviewSessionState;
  private listeners: Set<ReviewSessionListener> = new Set();
  private activeAbortController: AbortController | null = null;
  private isRatingFlashcard = false;

  constructor(dependencies: ReviewSessionDependencies) {
    this.deps = dependencies;
    this.state = this.createInitialState();
  }

  private createInitialState(): ReviewSessionState {
    return {
      sessionId: undefined,
      questions: [],
      currentIndex: 0,
      currentQuestion: null,
      totalQuestions: 0,
      isSessionCompleted: false,

      selectedChoiceId: null,
      freeTextInput: '',
      questionStartTimeMs: 0,

      submissionResult: null,
      isSubmitted: false,

      supportingPassages: [],
      sourcePages: [],

      isGeneratingAi: false,
      aiExplanation: null,
      streamingAiText: '',
      freeAnswerEvaluation: null,
      consensusEvaluation: null,
      aiError: null,
    };
  }

  public getState(): ReviewSessionState {
    return this.state;
  }

  public subscribe(listener: ReviewSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<ReviewSessionState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Initializes a review session, fetching questions according to the selection query.
   */
  public async startSession(params: StartSessionParams): Promise<void> {
    this.cancelActiveAiGeneration();

    const questions = await this.deps.getNextQuestion.execute({
      query: params.query,
      sessionSeed: params.sessionSeed,
      shuffleChoices: params.shuffleChoices ?? true,
    });

    const firstQuestion = questions[0] || null;

    this.updateState({
      sessionId: params.sessionId,
      questions,
      currentIndex: 0,
      currentQuestion: firstQuestion,
      totalQuestions: questions.length,
      isSessionCompleted: questions.length === 0,

      selectedChoiceId: null,
      freeTextInput: '',
      questionStartTimeMs: Date.now(),

      submissionResult: null,
      isSubmitted: false,

      supportingPassages: [],
      sourcePages: firstQuestion?.sourcePage ? [firstQuestion.sourcePage] : [],

      isGeneratingAi: false,
      aiExplanation: null,
      streamingAiText: '',
      freeAnswerEvaluation: null,
      consensusEvaluation: null,
      aiError: null,
    });
  }

  /**
   * Selects an option for multiple-choice questions.
   */
  public selectChoice(choiceId: string): void {
    if (this.state.isSubmitted || !this.state.currentQuestion) {
      return;
    }
    this.updateState({ selectedChoiceId: choiceId });
  }

  /**
   * Updates free-form text input for identification / essay questions.
   */
  public setFreeTextInput(text: string): void {
    if (this.state.isSubmitted || !this.state.currentQuestion) {
      return;
    }
    this.updateState({ freeTextInput: text });
  }

  /**
   * Deterministically submits the student's answer and retrieves grounded textbook passages.
   */
  public async submitCurrentAnswer(sessionIdOverride?: string): Promise<SubmitAnswerResponse | null> {
    const currentQ = this.state.currentQuestion;
    if (!currentQ || this.state.isSubmitted) {
      return this.state.submissionResult;
    }

    const durationMs = Math.max(1, Date.now() - this.state.questionStartTimeMs);
    const activeSessionId = sessionIdOverride || this.state.sessionId;

    const result = await this.deps.submitAnswer.execute({
      questionId: currentQ.id,
      selectedChoiceId: this.state.selectedChoiceId || undefined,
      freeTextAnswer: this.state.freeTextInput || undefined,
      sessionId: activeSessionId,
      durationMs,
    });

    let supportingPassages: RetrievedPassage[] = [];
    let sourcePages: number[] = currentQ.sourcePage ? [currentQ.sourcePage] : [];

    try {
      const context = await this.deps.getExplanationContext.execute(currentQ.id);
      supportingPassages = context.passages;
      sourcePages = context.sourcePages;
    } catch (err: any) {
      this.deps.logger?.warn('review_controller', `Could not fetch explanation context: ${err?.message}`);
    }

    this.updateState({
      isSubmitted: true,
      submissionResult: result,
      supportingPassages,
      sourcePages,
    });

    return result;
  }

  /**
   * Requests a grounded, textbook-backed AI explanation for the current question.
   */
  public async requestExplainMore(language?: 'en' | 'fil'): Promise<ExplainMoreResponse | null> {
    if (!this.state.currentQuestion || this.state.isGeneratingAi) {
      return null;
    }

    try {
      this.activeAbortController = new AbortController();
      this.updateState({ isGeneratingAi: true, aiError: null, streamingAiText: '' });

      let streamed = '';
      const result = await this.deps.explainMore.execute({
        questionId: this.state.currentQuestion.id,
        language,
        signal: this.activeAbortController.signal,
        onChunk: (chunk: string) => {
          streamed += chunk;
          this.updateState({ streamingAiText: streamed });
        },
      });

      const updatedPages = Array.from(
        new Set([...this.state.sourcePages, ...result.sourcePages])
      ).sort((a, b) => a - b);

      this.updateState({
        isGeneratingAi: false,
        aiExplanation: result.explanation,
        sourcePages: updatedPages,
        aiError: null,
      });

      return result;
    } catch (err: any) {
      const isAborted = this.activeAbortController?.signal.aborted || err?.name === 'AbortError';
      this.updateState({
        isGeneratingAi: false,
        aiError: isAborted ? 'Generation cancelled' : (err?.message ?? 'AI explanation failed'),
      });
      return null;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Requests semantic evaluation of a free-form identification or essay answer.
   */
  public async requestFreeAnswerInterpretation(): Promise<InterpretFreeAnswerResponse | null> {
    if (!this.state.currentQuestion || this.state.isGeneratingAi) {
      return null;
    }

    const studentAnswer = this.state.freeTextInput.trim();
    if (!studentAnswer) {
      return null;
    }

    try {
      this.activeAbortController = new AbortController();
      this.updateState({ isGeneratingAi: true, aiError: null });

      const result = await this.deps.interpretFreeAnswer.execute({
        questionId: this.state.currentQuestion.id,
        studentAnswer,
        signal: this.activeAbortController.signal,
      });

      this.updateState({
        isGeneratingAi: false,
        freeAnswerEvaluation: result.verdict,
        aiError: null,
      });

      return result;
    } catch (err: any) {
      const isAborted = this.activeAbortController?.signal.aborted || err?.name === 'AbortError';
      this.updateState({
        isGeneratingAi: false,
        aiError: isAborted ? 'Interpretation cancelled' : (err?.message ?? 'Semantic evaluation failed'),
      });
      return null;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Requests multi-sample Best-of-N probabilistic consensus evaluation for free answers.
   */
  public async requestConsensusInterpretation(numSamples = 3): Promise<ConsensusEvaluationBreakdown | null> {
    if (!this.state.currentQuestion || this.state.isGeneratingAi) {
      return null;
    }

    const studentAnswer = this.state.freeTextInput.trim();
    if (!studentAnswer) {
      return null;
    }

    try {
      this.activeAbortController = new AbortController();
      this.updateState({ isGeneratingAi: true, aiError: null });

      const result = await this.deps.interpretFreeAnswer.executeConsensus(
        this.state.currentQuestion.id,
        studentAnswer,
        numSamples,
        this.activeAbortController.signal
      );

      this.updateState({
        isGeneratingAi: false,
        consensusEvaluation: result,
        freeAnswerEvaluation: result.winningEvaluation,
        aiError: null,
      });

      return result;
    } catch (err: any) {
      const isAborted = this.activeAbortController?.signal.aborted || err?.name === 'AbortError';
      this.updateState({
        isGeneratingAi: false,
        aiError: isAborted ? 'Interpretation cancelled' : (err?.message ?? 'Consensus evaluation failed'),
      });
      return null;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Requests follow-up distractor elimination or clarification via Iterative RAG.
   */
  public async requestClarification(query: string): Promise<ExplainMoreResponse | null> {
    if (!this.state.currentQuestion || this.state.isGeneratingAi) {
      return null;
    }

    try {
      this.activeAbortController = new AbortController();
      this.updateState({ isGeneratingAi: true, aiError: null, streamingAiText: '' });

      let streamed = '';
      const result = await this.deps.explainMore.execute({
        questionId: this.state.currentQuestion.id,
        followUpQuery: query,
        signal: this.activeAbortController.signal,
        onChunk: (chunk: string) => {
          streamed += chunk;
          this.updateState({ streamingAiText: streamed });
        },
      });

      const updatedPages = Array.from(
        new Set([...this.state.sourcePages, ...result.sourcePages])
      ).sort((a, b) => a - b);

      this.updateState({
        isGeneratingAi: false,
        aiExplanation: result.explanation,
        sourcePages: updatedPages,
        aiError: null,
      });

      return result;
    } catch (err: any) {
      const isAborted = this.activeAbortController?.signal.aborted || err?.name === 'AbortError';
      this.updateState({
        isGeneratingAi: false,
        aiError: isAborted ? 'Clarification cancelled' : (err?.message ?? 'Clarification failed'),
      });
      return null;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Immediately aborts any in-flight LLM explanation or semantic grading task.
   */
  public cancelActiveAiGeneration(): boolean {
    if (this.activeAbortController) {
      const aborted = this.deps.cancelGeneration.execute({
        controller: this.activeAbortController,
        reason: 'User cancelled generation',
      });
      this.updateState({
        isGeneratingAi: false,
        aiError: 'Generation cancelled',
      });
      this.activeAbortController = null;
      return aborted;
    }
    return false;
  }

  /**
   * Rates the current flashcard ('again' | 'know') during active-recall review.
   * Records a 0.0 or 1.0 attempt and re-queues missed cards to the end of the session.
   */
  public async rateCurrentFlashcard(rating: 'again' | 'know'): Promise<SubmitAnswerResponse | null> {
    if (this.isRatingFlashcard) {
      return null;
    }
    const currentQ = this.state.currentQuestion;
    if (!currentQ) {
      return null;
    }

    this.isRatingFlashcard = true;
    try {
      this.cancelActiveAiGeneration();

      const isKnow = rating === 'know';
      const durationMs = Math.max(1, Date.now() - this.state.questionStartTimeMs);
      const activeSessionId = this.state.sessionId;

      let selectedChoiceId: string | undefined = undefined;
      let freeTextAnswer: string | undefined = undefined;

      if (currentQ.questionType === 'multiple_choice') {
        let canonicalChoiceId = currentQ.canonicalChoiceId || null;
        if (!canonicalChoiceId && currentQ.canonicalAnswer) {
          const normCanonical = currentQ.canonicalAnswer.trim().toLowerCase();
          const matchedChoice = currentQ.choices.find(
            (c) =>
              c.choiceKey.trim().toLowerCase() === normCanonical ||
              c.text.trim().toLowerCase() === normCanonical ||
              c.id === currentQ.canonicalAnswer
          );
          if (matchedChoice) {
            canonicalChoiceId = matchedChoice.id;
          }
        }

        if (isKnow) {
          selectedChoiceId = canonicalChoiceId || currentQ.choices[0]?.id;
        } else {
          // If rating 'again', pick a non-canonical choice if available. If none exist,
          // leave undefined so NULL is recorded in SQLite (satisfying foreign keys) with score 0.0.
          const nonCanonical = currentQ.choices.find((c) => c.id !== canonicalChoiceId);
          selectedChoiceId = nonCanonical?.id ?? undefined;
        }
      } else {
        freeTextAnswer = isKnow ? (currentQ.canonicalAnswer || 'know') : '';
      }

      const result = await this.deps.submitAnswer.execute({
        questionId: currentQ.id,
        selectedChoiceId,
        freeTextAnswer,
        sessionId: activeSessionId,
        durationMs,
      });

      // If rated 'again', re-queue the question at the end of the current questions array immutably
      if (rating === 'again') {
        const updatedQuestions = [...this.state.questions, currentQ];
        this.updateState({
          questions: updatedQuestions,
          totalQuestions: updatedQuestions.length,
        });
      }

      // Now advance to the next card
      this.nextQuestion();

      return result;
    } finally {
      this.isRatingFlashcard = false;
    }
  }

  /**
   * Advances the session to the next question.
   */
  public nextQuestion(): Question | null {
    this.cancelActiveAiGeneration();

    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.questions.length) {
      this.updateState({
        currentIndex: nextIndex,
        currentQuestion: null,
        isSessionCompleted: true,
        selectedChoiceId: null,
        freeTextInput: '',
        isSubmitted: false,
        submissionResult: null,
        supportingPassages: [],
        sourcePages: [],
        aiExplanation: null,
        streamingAiText: '',
        freeAnswerEvaluation: null,
        consensusEvaluation: null,
        isGeneratingAi: false,
        aiError: null,
      });
      return null;
    }

    const nextQ = this.state.questions[nextIndex];
    this.updateState({
      currentIndex: nextIndex,
      currentQuestion: nextQ,
      isSessionCompleted: false,
      selectedChoiceId: null,
      freeTextInput: '',
      questionStartTimeMs: Date.now(),
      isSubmitted: false,
      submissionResult: null,
      supportingPassages: [],
      sourcePages: nextQ.sourcePage ? [nextQ.sourcePage] : [],
      aiExplanation: null,
      streamingAiText: '',
      freeAnswerEvaluation: null,
      consensusEvaluation: null,
      isGeneratingAi: false,
      aiError: null,
    });

    return nextQ;
  }
}

