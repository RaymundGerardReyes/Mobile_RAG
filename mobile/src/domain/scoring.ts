import { Choice, Question } from './types.js';

/**
 * Normalizes answer text for robust string comparison.
 * Trims whitespace, collapses internal whitespace, and converts to lowercase.
 */
export function normalizeAnswerText(rawText: string | null | undefined): string {
  if (!rawText) return '';
  return rawText
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ');
}

export interface MultipleChoiceScoreResult {
  isCorrect: boolean;
  score: number;
  canonicalChoiceId: string | null;
  selectedChoiceId: string;
}

/**
 * Scores a multiple-choice response deterministically.
 * The official canonical answer key in the database is the sole authority.
 */
export function scoreMultipleChoice(
  question: Question,
  selectedChoiceId: string
): MultipleChoiceScoreResult {
  let canonicalId = question.canonicalChoiceId || null;

  // Fallback: if canonicalChoiceId is not directly linked, resolve via canonicalAnswer and choice keys/text
  if (!canonicalId && question.canonicalAnswer) {
    const normalizedCanonical = normalizeAnswerText(question.canonicalAnswer);
    const matchedChoice = question.choices.find(
      (c) =>
        normalizeAnswerText(c.choiceKey) === normalizedCanonical ||
        normalizeAnswerText(c.text) === normalizedCanonical ||
        c.id === question.canonicalAnswer
    );
    if (matchedChoice) {
      canonicalId = matchedChoice.id;
    }
  }

  const isCorrect = canonicalId !== null && canonicalId === selectedChoiceId;
  return {
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    canonicalChoiceId: canonicalId,
    selectedChoiceId,
  };
}

export interface FreeAnswerScoreResult {
  isCorrect: boolean;
  score: number;
  normalizedStudentAnswer: string;
  normalizedCanonicalAnswer: string;
}

/**
 * Deterministic exact normalized scoring for free-form or identification questions.
 */
export function scoreExactIdentification(
  canonicalAnswer: string | null | undefined,
  studentAnswer: string
): FreeAnswerScoreResult {
  const normCanonical = normalizeAnswerText(canonicalAnswer);
  const normStudent = normalizeAnswerText(studentAnswer);
  const isCorrect = normCanonical.length > 0 && normCanonical === normStudent;

  return {
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    normalizedStudentAnswer: normStudent,
    normalizedCanonicalAnswer: normCanonical,
  };
}

/**
 * Mulberry32 seeded 32-bit PRNG.
 * Produces deterministic pseudo-random numbers in [0, 1) for a given 32-bit integer seed.
 */
function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a stable 32-bit integer hash from a string seed.
 */
function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit offset
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Deterministically shuffles an array of choices using Fisher-Yates with a stable string seed.
 * Does NOT mutate the input array.
 * If choices length <= 1, returns a shallow copy immediately.
 */
export function deterministicChoiceShuffle(choices: Choice[], seed: string): Choice[] {
  if (choices.length <= 1) {
    return [...choices];
  }

  const result = [...choices];
  const rng = createMulberry32(hashStringToSeed(seed));

  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }

  return result;
}

const POSITIONAL_CHOICE_PATTERNS: RegExp[] = [
  /all\s+of\s+the\s+above/i,
  /none\s+of\s+the\s+above/i,
  /both\s+[a-d]\s+and\s+[a-d]/i,
  /neither\s+[a-d]\s+nor\s+[a-d]/i,
  /statements?\s+[a-d]\s+and\s+[a-d]/i,
  /options?\s+[a-d]\s+and\s+[a-d]/i,
  /lahat\s+ng\s+nabanggit/i,
  /wala\s+sa\s+nabanggit/i,
  /parehong\s+[a-d]\s+at\s+[a-d]/i,
  /wala\s+sa\s+[a-d]\s+at\s+[a-d]/i,
  /mga\s+pahayag\s+[a-d]\s+at\s+[a-d]/i,
];

/**
 * Checks whether a question's choices may be deterministically shuffled.
 * Shuffling is forbidden if choices contain positional dependencies such as
 * "All of the above", "None of the above", "Both A and B", "Lahat ng nabanggit", etc.
 */
export function canShuffleChoices(question: Question): boolean {
  if (question.questionType !== 'multiple_choice') {
    return false;
  }
  if (!question.choices || question.choices.length <= 1) {
    return false;
  }

  for (const choice of question.choices) {
    const text = choice.text;
    if (!text) continue;
    for (const pattern of POSITIONAL_CHOICE_PATTERNS) {
      if (pattern.test(text)) {
        return false;
      }
    }
  }

  return true;
}


