import { QuestionRepository, QuestionSelectionQuery } from '../ports/question_repository.js';
import { Question } from '../../domain/types.js';
import { deterministicChoiceShuffle, canShuffleChoices } from '../../domain/scoring.js';

export interface GetNextQuestionOptions {
  repository: QuestionRepository;
}

export interface GetNextQuestionRequest {
  query: QuestionSelectionQuery;
  sessionSeed?: string;
  shuffleChoices?: boolean;
}

export class GetNextQuestion {
  private repository: QuestionRepository;

  constructor(options: GetNextQuestionOptions) {
    this.repository = options.repository;
  }

  public async execute(request: GetNextQuestionRequest): Promise<Question[]> {
    const questions = await this.repository.getNextQuestions(request.query);
    const shouldShuffle = request.shuffleChoices !== false;
    const baseSeed = request.sessionSeed || 'default-session-seed';

    return questions.map((q) => {
      // Shuffling must be permitted by domain rules (no "All of the above" etc.)
      if (!shouldShuffle || !canShuffleChoices(q)) {
        return q;
      }

      // Seed deterministic shuffle per question
      const seed = `${baseSeed}_${q.id}`;
      const shuffled = deterministicChoiceShuffle(q.choices, seed);

      return {
        ...q,
        choices: shuffled,
      };
    });
  }
}


