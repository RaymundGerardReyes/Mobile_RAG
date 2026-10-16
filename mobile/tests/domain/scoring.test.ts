import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canShuffleChoices,
  deterministicChoiceShuffle,
  normalizeAnswerText,
  scoreExactIdentification,
  scoreMultipleChoice,
} from '../../src/domain/scoring.js';
import { Choice, Question } from '../../src/domain/types.js';

describe('Domain: Scoring and Shuffling', () => {
  const sampleChoices: Choice[] = [
    { id: 'c1', questionId: 'q1', choiceKey: 'A', text: 'Executive', sortOrder: 1 },
    { id: 'c2', questionId: 'q1', choiceKey: 'B', text: 'Legislative', sortOrder: 2 },
    { id: 'c3', questionId: 'q1', choiceKey: 'C', text: 'Judiciary', sortOrder: 3 },
    { id: 'c4', questionId: 'q1', choiceKey: 'D', text: 'Civil Service Commission', sortOrder: 4 },
  ];

  const sampleQuestion: Question = {
    id: 'q1',
    topicId: 't1',
    questionType: 'multiple_choice',
    stem: 'Which branch of government is responsible for making laws?',
    canonicalExplanation: 'Article VI of the 1987 Constitution vests legislative power in Congress.',
    sourcePage: 15,
    difficulty: 'easy',
    contentVersion: '2026.10.1',
    choices: sampleChoices,
    canonicalChoiceId: 'c2',
    canonicalAnswer: 'B',
  };

  it('normalizes answer text correctly', () => {
    assert.equal(normalizeAnswerText('   Constitutional   Commission   '), 'constitutional commission');
    assert.equal(normalizeAnswerText('“Executive”'), '"executive"');
    assert.equal(normalizeAnswerText("‘Article IX’"), "'article ix'");
    assert.equal(normalizeAnswerText(''), '');
    assert.equal(normalizeAnswerText(null), '');
  });

  it('scores multiple choice question correctly with matching canonicalChoiceId', () => {
    const correctResult = scoreMultipleChoice(sampleQuestion, 'c2');
    assert.equal(correctResult.isCorrect, true);
    assert.equal(correctResult.score, 1.0);
    assert.equal(correctResult.canonicalChoiceId, 'c2');

    const wrongResult = scoreMultipleChoice(sampleQuestion, 'c1');
    assert.equal(wrongResult.isCorrect, false);
    assert.equal(wrongResult.score, 0.0);
  });

  it('resolves canonical choice via canonicalAnswer fallback when canonicalChoiceId is missing', () => {
    const questionWithoutCanonicalId: Question = {
      ...sampleQuestion,
      canonicalChoiceId: null,
      canonicalAnswer: 'Judiciary',
    };

    const result = scoreMultipleChoice(questionWithoutCanonicalId, 'c3');
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.canonicalChoiceId, 'c3');
  });

  it('scores exact identification answers with normalization', () => {
    const correctRes = scoreExactIdentification('Civil Service Commission', '   civil service commission  ');
    assert.equal(correctRes.isCorrect, true);
    assert.equal(correctRes.score, 1.0);

    const wrongRes = scoreExactIdentification('Commission on Elections', 'Commission on Audit');
    assert.equal(wrongRes.isCorrect, false);
    assert.equal(wrongRes.score, 0.0);

    const emptyRes = scoreExactIdentification('', '');
    assert.equal(emptyRes.isCorrect, false);
    assert.equal(emptyRes.score, 0.0);
  });

  it('performs seeded choice shuffling deterministically without mutating input', () => {
    const originalOrder = sampleChoices.map((c) => c.id);
    const shuffled1 = deterministicChoiceShuffle(sampleChoices, 'seed-session-123_q1');
    const shuffled2 = deterministicChoiceShuffle(sampleChoices, 'seed-session-123_q1');

    // Reproducibility check
    assert.deepEqual(
      shuffled1.map((c) => c.id),
      shuffled2.map((c) => c.id)
    );

    // Immobility of original input check
    assert.deepEqual(
      sampleChoices.map((c) => c.id),
      originalOrder
    );

    // Different seed should yield different permutation (or at least valid permutation)
    const shuffledDifferent = deterministicChoiceShuffle(sampleChoices, 'completely-different-seed-456');
    assert.equal(shuffledDifferent.length, 4);

    // Empty and single-element edge cases
    assert.deepEqual(deterministicChoiceShuffle([], 'seed'), []);
    assert.deepEqual(deterministicChoiceShuffle([sampleChoices[0]!], 'seed'), [sampleChoices[0]!]);
  });

  it('canShuffleChoices forbids shuffling when positional choices are present', () => {
    // English positional choices
    const questionWithAllAbove: Question = {
      ...sampleQuestion,
      choices: [
        { id: 'c1', questionId: 'q1', choiceKey: 'A', text: 'President', sortOrder: 1 },
        { id: 'c2', questionId: 'q1', choiceKey: 'B', text: 'Vice President', sortOrder: 2 },
        { id: 'c3', questionId: 'q1', choiceKey: 'C', text: 'Cabinet Secretary', sortOrder: 3 },
        { id: 'c4', questionId: 'q1', choiceKey: 'D', text: 'All of the above', sortOrder: 4 },
      ],
    };
    assert.equal(canShuffleChoices(questionWithAllAbove), false);

    const questionWithBothAB: Question = {
      ...sampleQuestion,
      choices: [
        { id: 'c1', questionId: 'q1', choiceKey: 'A', text: 'Option 1', sortOrder: 1 },
        { id: 'c2', questionId: 'q1', choiceKey: 'B', text: 'Option 2', sortOrder: 2 },
        { id: 'c3', questionId: 'q1', choiceKey: 'C', text: 'Both A and B', sortOrder: 3 },
        { id: 'c4', questionId: 'q1', choiceKey: 'D', text: 'None of the above', sortOrder: 4 },
      ],
    };
    assert.equal(canShuffleChoices(questionWithBothAB), false);

    // Filipino positional choices
    const questionWithLahat: Question = {
      ...sampleQuestion,
      choices: [
        { id: 'c1', questionId: 'q1', choiceKey: 'A', text: 'Pangulong Bansa', sortOrder: 1 },
        { id: 'c2', questionId: 'q1', choiceKey: 'B', text: 'Pangalawang Pangulo', sortOrder: 2 },
        { id: 'c3', questionId: 'q1', choiceKey: 'C', text: 'Lahat ng nabanggit', sortOrder: 3 },
      ],
    };
    assert.equal(canShuffleChoices(questionWithLahat), false);

    const questionWithWala: Question = {
      ...sampleQuestion,
      choices: [
        { id: 'c1', questionId: 'q1', choiceKey: 'A', text: 'Korte Suprema', sortOrder: 1 },
        { id: 'c2', questionId: 'q1', choiceKey: 'B', text: 'Kongreso', sortOrder: 2 },
        { id: 'c3', questionId: 'q1', choiceKey: 'C', text: 'Wala sa nabanggit', sortOrder: 3 },
      ],
    };
    assert.equal(canShuffleChoices(questionWithWala), false);

    // Standard multiple choice question without positional dependencies: permitted
    assert.equal(canShuffleChoices(sampleQuestion), true);

    // Identification question: not permitted
    const identQuestion: Question = {
      ...sampleQuestion,
      questionType: 'identification',
      choices: [],
    };
    assert.equal(canShuffleChoices(identQuestion), false);
  });
});

