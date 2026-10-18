import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { colors } from './src/theme/tokens.js';
import {
  ReviewHomeScreen,
  SessionFormat,
  StudyMode,
} from './src/features/review/ReviewHomeScreen.js';
import { QuizReviewScreen } from './src/features/quiz/QuizReviewScreen.js';
import { AnswerAttempt, Passage, Question, Topic } from './src/domain/types.js';
import {
  QuestionRepository,
  QuestionSelectionQuery,
  TopicSummary,
} from './src/application/ports/question_repository.js';
import {
  PassageRetriever,
  RetrievedPassage,
} from './src/application/ports/passage_retriever.js';
import {
  GenerationChunk,
  GenerationRequest,
  LocalLlmPort,
  ModelRuntimeStatus,
} from './src/application/ports/local_llm_port.js';
import { GetNextQuestion } from './src/application/use_cases/get_next_question.js';
import { SubmitAnswer } from './src/application/use_cases/submit_answer.js';
import { GetExplanationContext } from './src/application/use_cases/get_explanation_context.js';
import { ExplainMore } from './src/application/use_cases/explain_more.js';
import { InterpretFreeAnswer } from './src/application/use_cases/interpret_free_answer.js';
import { CancelGeneration } from './src/application/use_cases/cancel_generation.js';
import {
  ReviewSessionController,
  ReviewSessionState,
} from './src/controllers/review_session_controller.js';
import { DiagnosticsLogger } from './src/diagnostics/diagnostics_logger.js';

const INITIAL_TOPICS: TopicSummary[] = [
  {
    topic: {
      id: 'ph-constitution-general-info',
      title: 'Philippine Constitution & General Information',
      sortOrder: 1,
    },
    totalQuestions: 150,
    answeredCount: 45,
    correctCount: 40,
  },
  {
    topic: {
      id: 'verbal-ability',
      title: 'Verbal Ability (English & Filipino)',
      sortOrder: 2,
    },
    totalQuestions: 200,
    answeredCount: 120,
    correctCount: 95,
  },
  {
    topic: {
      id: 'analytical-reasoning',
      title: 'Analytical & Logical Reasoning',
      sortOrder: 3,
    },
    totalQuestions: 120,
    answeredCount: 60,
    correctCount: 45,
  },
  {
    topic: {
      id: 'numerical-reasoning',
      title: 'Numerical Reasoning',
      sortOrder: 4,
    },
    totalQuestions: 100,
    answeredCount: 30,
    correctCount: 20,
  },
];

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'q0001',
    topicId: 'ph-constitution-general-info',
    questionType: 'multiple_choice',
    stem: 'According to Article II of the 1987 Philippine Constitution, what is the prime duty of the Government?',
    canonicalExplanation:
      'Article II, Section 4 declares that the prime duty of the Government is to serve and protect the people.',
    sourcePage: 12,
    difficulty: 'medium',
    contentVersion: '2026.10.1',
    canonicalChoiceId: 'c0002',
    canonicalAnswer: 'B',
    choices: [
      {
        id: 'c0001',
        questionId: 'q0001',
        choiceKey: 'A',
        text: 'To collect taxes efficiently',
        sortOrder: 1,
      },
      {
        id: 'c0002',
        questionId: 'q0001',
        choiceKey: 'B',
        text: 'To serve and protect the people',
        sortOrder: 2,
      },
      {
        id: 'c0003',
        questionId: 'q0001',
        choiceKey: 'C',
        text: 'To maintain foreign embassies',
        sortOrder: 3,
      },
      {
        id: 'c0004',
        questionId: 'q0001',
        choiceKey: 'D',
        text: 'To regulate private enterprises',
        sortOrder: 4,
      },
    ],
  },
  {
    id: 'q0002',
    topicId: 'ph-constitution-general-info',
    questionType: 'multiple_choice',
    stem: 'Under R.A. 6713, within how many days must public officials respond to letters and requests sent by the public?',
    canonicalExplanation:
      'Section 5(a) of R.A. 6713 mandates an official response within fifteen (15) working days from receipt.',
    sourcePage: 28,
    difficulty: 'medium',
    contentVersion: '2026.10.1',
    canonicalChoiceId: 'c0006',
    canonicalAnswer: 'B',
    choices: [
      {
        id: 'c0005',
        questionId: 'q0002',
        choiceKey: 'A',
        text: '10 working days',
        sortOrder: 1,
      },
      {
        id: 'c0006',
        questionId: 'q0002',
        choiceKey: 'B',
        text: '15 working days',
        sortOrder: 2,
      },
      {
        id: 'c0007',
        questionId: 'q0002',
        choiceKey: 'C',
        text: '30 working days',
        sortOrder: 3,
      },
      {
        id: 'c0008',
        questionId: 'q0002',
        choiceKey: 'D',
        text: '45 working days',
        sortOrder: 4,
      },
    ],
  },
  {
    id: 'q0003',
    topicId: 'ph-constitution-general-info',
    questionType: 'identification',
    stem: 'What is the title of Republic Act No. 6713?',
    canonicalExplanation:
      'R.A. 6713 is the Code of Conduct and Ethical Standards for Public Officials and Employees.',
    sourcePage: 26,
    difficulty: 'hard',
    contentVersion: '2026.10.1',
    canonicalAnswer:
      'Code of Conduct and Ethical Standards for Public Officials and Employees',
    choices: [],
  },
];

const SAMPLE_PASSAGES: Record<string, RetrievedPassage[]> = {
  q0001: [
    {
      passage: {
        id: 'p0012',
        chapter: '1987 Constitution',
        section: 'Article II: Declaration of Principles and State Policies',
        startPage: 12,
        endPage: 12,
        text: 'Section 4. The prime duty of the Government is to serve and protect the people. The Government may call upon the people to defend the State and, in the fulfillment thereof, all citizens may be required, under conditions provided by law, to render personal military or civil service.',
        contentHash: 'hash_p0012',
      },
      strategy: 'linked',
      confidence: 'high',
    },
  ],
  q0002: [
    {
      passage: {
        id: 'p0028',
        chapter: 'Republic Act No. 6713',
        section: 'Duties of Public Officials and Employees',
        startPage: 28,
        endPage: 28,
        text: 'Section 5. In the performance of their duties, all public officials and employees are under obligation to: (a) Act promptly on letters and requests. - All public officials and employees shall, within fifteen (15) working days from receipt thereof, respond to letters, telegrams or other means of communications sent by the public.',
        contentHash: 'hash_p0028',
      },
      strategy: 'linked',
      confidence: 'high',
    },
  ],
  q0003: [
    {
      passage: {
        id: 'p0026',
        chapter: 'Republic Act No. 6713',
        section: 'Title and Policy',
        startPage: 26,
        endPage: 26,
        text: 'Section 1. Title. - This Act shall be known as the "Code of Conduct and Ethical Standards for Public Officials and Employees."',
        contentHash: 'hash_p0026',
      },
      strategy: 'linked',
      confidence: 'high',
    },
  ],
};

/**
 * In-memory repository implementing QuestionRepository & PassageRetriever.
 * Dynamically tracks student answer attempts and recalculates topic summaries.
 */
class InMemoryQuestionRepository implements QuestionRepository, PassageRetriever {
  private questions: Question[];
  private topics: TopicSummary[];
  private passagesMap: Record<string, RetrievedPassage[]>;
  private attempts: AnswerAttempt[] = [];

  constructor(
    questions: Question[],
    topics: TopicSummary[],
    passages: Record<string, RetrievedPassage[]>
  ) {
    this.questions = [...questions];
    this.topics = topics.map((t) => ({ ...t, topic: { ...t.topic } }));
    this.passagesMap = passages;
  }

  async getQuestionById(id: string): Promise<Question | null> {
    return this.questions.find((q) => q.id === id) || null;
  }

  async getNextQuestions(query: QuestionSelectionQuery): Promise<Question[]> {
    let result = [...this.questions];

    if (query.topicId) {
      result = result.filter((q) => q.topicId === query.topicId);
    }

    if (query.mode === 'unanswered') {
      const answeredIds = new Set(this.attempts.map((a) => a.questionId));
      result = result.filter((q) => !answeredIds.has(q.id));
    } else if (query.mode === 'weak_areas') {
      const incorrectIds = new Set(
        this.attempts.filter((a) => !a.isCorrect || a.score < 1.0).map((a) => a.questionId)
      );
      const weak = result.filter((q) => incorrectIds.has(q.id));
      if (weak.length > 0) {
        result = weak;
      }
    }

    if (query.excludeQuestionIds && query.excludeQuestionIds.length > 0) {
      const excludeSet = new Set(query.excludeQuestionIds);
      result = result.filter((q) => !excludeSet.has(q.id));
    }

    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  async recordAttempt(attempt: AnswerAttempt): Promise<void> {
    const isFirstAttemptOnThisQuestion = !this.attempts.some(
      (a) => a.questionId === attempt.questionId
    );
    const wasAlreadyCorrect = this.attempts.some(
      (a) => a.questionId === attempt.questionId && a.isCorrect
    );

    this.attempts.push(attempt);

    const question = this.questions.find((q) => q.id === attempt.questionId);
    if (!question) return;

    const topicSummary = this.topics.find((t) => t.topic.id === question.topicId);
    if (topicSummary) {
      if (isFirstAttemptOnThisQuestion) {
        topicSummary.answeredCount += 1;
      }
      if (attempt.isCorrect && !wasAlreadyCorrect) {
        topicSummary.correctCount += 1;
      }
    }
  }

  async getTopicSummaries(): Promise<TopicSummary[]> {
    return this.topics.map((t) => ({ ...t, topic: { ...t.topic } }));
  }

  async retrieveForQuestion(
    questionId: string,
    _stem: string,
    _limit?: number
  ): Promise<RetrievedPassage[]> {
    return this.passagesMap[questionId] || [];
  }

  async searchPassages(query: string, _limit?: number): Promise<RetrievedPassage[]> {
    const norm = query.toLowerCase();
    const matches: RetrievedPassage[] = [];
    for (const passages of Object.values(this.passagesMap)) {
      for (const p of passages) {
        if (p.passage.text.toLowerCase().includes(norm)) {
          matches.push(p);
        }
      }
    }
    return matches;
  }
}

/**
 * On-device local LLM port mock providing realistic streaming generation
 * and JSON-schema compliant rubric verdicts.
 */
class LocalMockLlmPort implements LocalLlmPort {
  async getStatus(): Promise<ModelRuntimeStatus> {
    return {
      state: 'ready',
      manifestId: 'qwen2.5-1.5b-csc',
      modelName: 'Qwen2.5-1.5B-Instruct-Q4_K_M',
      peakMemoryBytes: 850 * 1024 * 1024,
    };
  }

  async load(): Promise<void> {}

  async release(): Promise<void> {}

  async *generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): AsyncIterable<GenerationChunk> {
    const isRubric =
      request.prompt.includes('interpret_free_answer') ||
      request.prompt.includes('verdict') ||
      request.prompt.includes('student_answer');

    if (isRubric) {
      const responsePayload = JSON.stringify({
        verdict: 'equivalent',
        matched_concepts: [
          'Code of Conduct and Ethical Standards for Public Officials and Employees',
          'R.A. 6713',
        ],
        missing_concepts: [],
        evidence_passage_ids: ['p0026'],
        confidence: 0.95,
      });

      const words = responsePayload.split(' ');
      for (let i = 0; i < words.length; i++) {
        if (signal?.aborted) throw new Error('Generation cancelled');
        yield { text: words[i] + (i === words.length - 1 ? '' : ' '), isComplete: i === words.length - 1 };
      }
      return;
    }

    const isFilipino = request.prompt.includes('Tagalog') || request.prompt.includes('Filipino');
    const text = isFilipino
      ? 'Ayon sa Saligang Batas at mga opisyal na dokumento ng Komisyon sa Serbisyo Sibil, ang sagot na ito ay itinatadhana upang matiyak ang pananagutan at tapat na paglilingkod sa bayan.'
      : 'Grounded in the official Philippine Civil Service Commission reference manuals, this provision establishes the legal standard tested in the Civil Service Examination.';

    const chunks = text.split(' ');
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw new Error('Generation cancelled');
      yield { text: chunks[i] + (i === chunks.length - 1 ? '' : ' '), isComplete: i === chunks.length - 1 };
    }
  }
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'quiz'>('home');
  const [selectedMode, setSelectedMode] = useState<StudyMode>('all');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('quiz');
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(undefined);
  const [topicSummaries, setTopicSummaries] = useState<TopicSummary[]>(INITIAL_TOPICS);

  const modelStatus: ModelRuntimeStatus = {
    state: 'ready',
    manifestId: 'qwen2.5-1.5b-csc',
    modelName: 'Qwen2.5-1.5B-Instruct-Q4_K_M',
    peakMemoryBytes: 850 * 1024 * 1024,
  };

  // Instantiate clean architecture dependencies once
  const { controller, repo } = useMemo(() => {
    const repository = new InMemoryQuestionRepository(
      SAMPLE_QUESTIONS,
      INITIAL_TOPICS,
      SAMPLE_PASSAGES
    );
    const llmPort = new LocalMockLlmPort();
    const logger = new DiagnosticsLogger(50);

    const getNextQuestion = new GetNextQuestion({ repository });
    const submitAnswer = new SubmitAnswer(repository);
    const getExplanationContext = new GetExplanationContext(repository, repository);
    const explainMore = new ExplainMore(repository, repository, llmPort, logger);
    const interpretFreeAnswer = new InterpretFreeAnswer(repository, repository, llmPort, logger);
    const cancelGeneration = new CancelGeneration(logger);

    const sessionController = new ReviewSessionController({
      getNextQuestion,
      submitAnswer,
      getExplanationContext,
      explainMore,
      interpretFreeAnswer,
      cancelGeneration,
      logger,
    });

    return { controller: sessionController, repo: repository };
  }, []);

  const [controllerState, setControllerState] = useState<ReviewSessionState>(
    controller.getState()
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setControllerState(newState);
    });
    return unsubscribe;
  }, [controller]);

  const refreshTopics = useCallback(async () => {
    const updated = await repo.getTopicSummaries();
    setTopicSummaries([...updated]);
  }, [repo]);

  const handleStartSession = useCallback(
    async (
      topicId?: string,
      mode: StudyMode = 'all',
      format: SessionFormat = 'quiz'
    ) => {
      setActiveTopicId(topicId);
      setSelectedMode(mode);
      setSessionFormat(format);

      await controller.startSession({
        query: { topicId, mode },
        shuffleChoices: false,
      });

      setCurrentScreen('quiz');
    },
    [controller]
  );

  const handleSubmitAnswer = useCallback(async () => {
    await controller.submitCurrentAnswer();
    await refreshTopics();
  }, [controller, refreshTopics]);

  const handleRateCard = useCallback(
    async (rating: 'again' | 'know') => {
      await controller.rateCurrentFlashcard(rating);
      await refreshTopics();
    },
    [controller, refreshTopics]
  );

  const handleRestartSession = useCallback(() => {
    handleStartSession(activeTopicId, selectedMode, sessionFormat);
  }, [handleStartSession, activeTopicId, selectedMode, sessionFormat]);

  const handleReturnHome = useCallback(async () => {
    setCurrentScreen('home');
    await refreshTopics();
  }, [refreshTopics]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      {currentScreen === 'home' ? (
        <ReviewHomeScreen
          topicSummaries={topicSummaries}
          selectedMode={selectedMode}
          modelStatus={modelStatus}
          onSelectMode={setSelectedMode}
          onStartSession={handleStartSession}
        />
      ) : (
        <QuizReviewScreen
          question={controllerState.currentQuestion}
          questionNumber={controllerState.currentIndex + 1}
          totalQuestions={controllerState.totalQuestions}
          selectedChoiceId={controllerState.selectedChoiceId}
          freeTextInput={controllerState.freeTextInput}
          submissionResult={controllerState.submissionResult}
          supportingPassages={controllerState.supportingPassages}
          sourcePages={controllerState.sourcePages}
          aiExplanation={controllerState.aiExplanation}
          streamingAiText={controllerState.streamingAiText}
          freeAnswerEvaluation={controllerState.freeAnswerEvaluation}
          modelStatus={modelStatus}
          isGeneratingAi={controllerState.isGeneratingAi}
          aiError={controllerState.aiError}
          isSessionCompleted={controllerState.isSessionCompleted}
          sessionFormat={sessionFormat}
          onSelectChoice={(id) => controller.selectChoice(id)}
          onChangeFreeText={(text) => controller.setFreeTextInput(text)}
          onSubmitAnswer={handleSubmitAnswer}
          onRequestExplainMore={(lang) => controller.requestExplainMore(lang)}
          onRequestInterpretFreeAnswer={() =>
            controller.requestFreeAnswerInterpretation()
          }
          onCancelGeneration={() => controller.cancelActiveAiGeneration()}
          onNextQuestion={() => controller.nextQuestion()}
          onRateCard={handleRateCard}
          onRestartSession={handleRestartSession}
          onReturnHome={handleReturnHome}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
  },
});
