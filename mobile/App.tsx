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

import liveContentPack from './assets/live_content_pack.json' with { type: 'json' };

const LIVE_TOPICS: TopicSummary[] = (liveContentPack.topicSummaries || []) as TopicSummary[];
const LIVE_QUESTIONS: Question[] = (liveContentPack.questions || []) as unknown as Question[];
const LIVE_PASSAGES_MAP: Record<string, RetrievedPassage[]> = Object.fromEntries(
  Object.entries(liveContentPack.questionPassagesMap || {}).map(([qId, passages]) => [
    qId,
    (passages as Array<{ passage: any; source?: string; relevanceScore?: number }>).map((p) => ({
      passage: p.passage,
      strategy: (p.source === 'linked' ? 'linked' : 'fts5') as 'linked' | 'fts5',
      confidence: 'high',
      rank: 1,
    })),
  ])
);

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
  const [topicSummaries, setTopicSummaries] = useState<TopicSummary[]>(LIVE_TOPICS);

  const modelStatus: ModelRuntimeStatus = {
    state: 'ready',
    manifestId: 'qwen2.5-1.5b-csc',
    modelName: 'Qwen2.5-1.5B-Instruct-Q4_K_M',
    peakMemoryBytes: 850 * 1024 * 1024,
  };

  // Instantiate clean architecture dependencies once
  const { controller, repo } = useMemo(() => {
    const repository = new InMemoryQuestionRepository(
      LIVE_QUESTIONS,
      LIVE_TOPICS,
      LIVE_PASSAGES_MAP
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
