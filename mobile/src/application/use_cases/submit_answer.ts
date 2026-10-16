import { QuestionRepository } from '../ports/question_repository.js';
import { AnswerAttempt } from '../../domain/types.js';
import { scoreMultipleChoice, scoreExactIdentification } from '../../domain/scoring.js';

export interface SubmitAnswerRequest {
  questionId: string;
  selectedChoiceId?: string;
  freeTextAnswer?: string;
  sessionId?: string;
  durationMs: number;
}

export interface SubmitAnswerResponse {
  attempt: AnswerAttempt;
  isCorrect: boolean;
  score: number;
  canonicalChoiceId: string | null;
  canonicalAnswer: string | null;
  canonicalExplanation: string | null;
}

export class SubmitAnswer {
  private repository: QuestionRepository;

  constructor(repository: QuestionRepository) {
    this.repository = repository;
  }

  public async execute(request: SubmitAnswerRequest): Promise<SubmitAnswerResponse> {
    const question = await this.repository.getQuestionById(request.questionId);
    if (!question) {
      throw new Error(`Question not found: ${request.questionId}`);
    }

    let isCorrect = false;
    let score = 0.0;
    let canonicalChoiceId = question.canonicalChoiceId ?? null;
    let selectedChoiceId = request.selectedChoiceId ?? null;

    // Resolve choice from freeTextAnswer if selectedChoiceId was omitted for multiple_choice
    if (!selectedChoiceId && request.freeTextAnswer && question.choices.length > 0) {
      const normInput = request.freeTextAnswer.trim().toLowerCase();
      const matched = question.choices.find(
        (c) =>
          c.choiceKey.trim().toLowerCase() === normInput ||
          c.text.trim().toLowerCase() === normInput ||
          c.id === request.freeTextAnswer
      );
      if (matched) {
        selectedChoiceId = matched.id;
      }
    }

    if (question.questionType === 'multiple_choice' || selectedChoiceId) {
      const mcResult = scoreMultipleChoice(question, selectedChoiceId || '');
      isCorrect = mcResult.isCorrect;
      score = mcResult.score;
      canonicalChoiceId = mcResult.canonicalChoiceId;
    } else {
      const freeResult = scoreExactIdentification(
        question.canonicalAnswer,
        request.freeTextAnswer || ''
      );
      isCorrect = freeResult.isCorrect;
      score = freeResult.score;
    }

    let canonicalAnswer = question.canonicalAnswer ?? null;
    if (!canonicalAnswer && canonicalChoiceId) {
      const canonicalChoice = question.choices.find((c) => c.id === canonicalChoiceId);
      if (canonicalChoice) {
        canonicalAnswer = canonicalChoice.choiceKey;
      }
    }

    const attemptId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const attempt: AnswerAttempt = {
      id: attemptId,
      sessionId: request.sessionId ?? null,
      questionId: question.id,
      selectedChoiceId,
      freeTextAnswer: request.freeTextAnswer ?? null,
      isCorrect,
      score,
      durationMs: request.durationMs,
      answeredAt: new Date().toISOString(),
    };

    await this.repository.recordAttempt(attempt);

    return {
      attempt,
      isCorrect,
      score,
      canonicalChoiceId,
      canonicalAnswer,
      canonicalExplanation: question.canonicalExplanation ?? null,
    };
  }
}

