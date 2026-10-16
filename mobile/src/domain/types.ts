/**
 * Pure domain types for the AI Tutor mobile core.
 * Zero external dependencies (no React, Expo, SQLite, or LLM SDK imports).
 */

export type QuestionType = 'multiple_choice' | 'identification' | 'essay';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Choice {
  id: string;
  questionId: string;
  choiceKey: string;
  text: string;
  sortOrder: number;
}

export interface Question {
  id: string;
  topicId: string;
  questionType: QuestionType;
  stem: string;
  canonicalExplanation?: string | null;
  sourcePage: number;
  difficulty?: Difficulty | null;
  contentVersion: string;
  choices: Choice[];
  canonicalChoiceId?: string | null;
  canonicalAnswer?: string | null;
}

export interface Topic {
  id: string;
  title: string;
  sortOrder: number;
}

export interface Passage {
  id: string;
  chapter: string;
  section?: string | null;
  startPage: number;
  endPage: number;
  text: string;
  contentHash: string;
  wordCount?: number;
}

export interface AnswerAttempt {
  id: string;
  sessionId?: string | null;
  questionId: string;
  selectedChoiceId?: string | null;
  freeTextAnswer?: string | null;
  isCorrect: boolean;
  score: number;
  durationMs: number;
  answeredAt: string; // ISO 8601 string
}

export interface StudySession {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  mode: 'topic' | 'exam' | 'weak_areas';
}

