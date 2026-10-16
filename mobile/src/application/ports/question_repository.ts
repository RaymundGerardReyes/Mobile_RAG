import { AnswerAttempt, Question, Topic } from '../../domain/types.js';

export interface QuestionSelectionQuery {
  topicId?: string;
  limit?: number;
  mode?: 'all' | 'unanswered' | 'weak_areas';
  excludeQuestionIds?: string[];
}

export interface TopicSummary {
  topic: Topic;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
}

export interface QuestionRepository {
  getQuestionById(id: string): Promise<Question | null>;
  getNextQuestions(query: QuestionSelectionQuery): Promise<Question[]>;
  recordAttempt(attempt: AnswerAttempt): Promise<void>;
  getTopicSummaries(): Promise<TopicSummary[]>;
}

