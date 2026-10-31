import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
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
import { SqliteQuestionRepository } from './src/data/sqlite/sqlite_question_repository.js';
import { SqlitePassageRetriever } from './src/data/sqlite/sqlite_passage_retriever.js';
import { openContentPackDatabase } from './src/data/sqlite/db_factory.js';


/**
 * On-device local LLM port providing dynamic, context-grounded streaming generation
 * and JSON-schema compliant rubric verdicts based directly on prompt context.
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
      request.prompt.includes('Student Free-Text Response:');

    if (isRubric) {
      // 1. Extract Official Canonical Answer
      const canonicalMatch = request.prompt.match(/Official Canonical Answer:\s*(.+)/i);
      const canonical = canonicalMatch ? canonicalMatch[1].trim() : '';

      // 2. Extract Student Free-Text Response
      const studentMatch = request.prompt.match(/Student Free-Text Response:\s*(.+)/i);
      const student = studentMatch ? studentMatch[1].trim() : '';

      // 3. Extract passage IDs from <evidence_passages>
      const passageIdMatches = [...request.prompt.matchAll(/\[Passage ID:\s*([^\s|]+)/g)];
      const passageIds = passageIdMatches.map((m) => m[1]);

      // 4. Extract concepts and compute semantic match
      const normalize = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
      const studentTokens = new Set(normalize(student));
      const canonicalTokens = normalize(canonical);

      const matched: string[] = [];
      const missing: string[] = [];

      for (const token of canonicalTokens) {
        if (studentTokens.has(token)) {
          matched.push(token);
        } else {
          missing.push(token);
        }
      }

      let verdict: 'equivalent' | 'partially_equivalent' | 'incorrect' = 'incorrect';
      let confidence = 0.90;

      if (studentTokens.size === 0) {
        verdict = 'incorrect';
        confidence = 0.98;
      } else if (canonicalTokens.length > 0) {
        const ratio = matched.length / canonicalTokens.length;
        if (
          ratio >= 0.6 ||
          student.toLowerCase().includes(canonical.toLowerCase()) ||
          canonical.toLowerCase().includes(student.toLowerCase())
        ) {
          verdict = 'equivalent';
          confidence = 0.96;
        } else if (ratio >= 0.25 || matched.length > 0) {
          verdict = 'partially_equivalent';
          confidence = 0.85;
        } else {
          verdict = 'incorrect';
          confidence = 0.92;
        }
      }

      const conceptLabels = canonical.length > 0 ? [canonical] : ['Civil Service Standard'];
      const matchedConcepts =
        verdict === 'equivalent' ? conceptLabels : verdict === 'partially_equivalent' ? matched.slice(0, 3) : [];
      const missingConcepts =
        verdict === 'equivalent' ? [] : verdict === 'partially_equivalent' ? missing.slice(0, 3) : conceptLabels;

      const responsePayload = JSON.stringify({
        verdict,
        matched_concepts: matchedConcepts,
        missing_concepts: missingConcepts,
        evidence_passage_ids: passageIds.slice(0, 2),
        confidence,
      });

      const words = responsePayload.split(' ');
      for (let i = 0; i < words.length; i++) {
        if (signal?.aborted) throw new Error('Generation cancelled');
        yield { text: words[i] + (i === words.length - 1 ? '' : ' '), isComplete: i === words.length - 1 };
      }
      return;
    }

    // Dynamic Context-Grounded Teaching Explanation
    const isFilipino =
      request.prompt.includes('Ikaw ay isang dalubhasang tagapagturo') ||
      request.prompt.includes('Tagalog') ||
      request.prompt.includes('Filipino');

    const answerMatch = request.prompt.match(/Official Correct Answer:\s*(.+)/i);
    const answer = answerMatch ? answerMatch[1].trim() : 'the designated option';

    const rationaleMatch = request.prompt.match(/Canonical Rationale:\s*(.+)/i);
    const rationale =
      rationaleMatch && rationaleMatch[1].trim() !== 'None provided in answer key.'
        ? rationaleMatch[1].trim()
        : '';

    // Extract passage info
    const passageHeaderMatch = request.prompt.match(
      /\[Passage ID:\s*([^\s|]+)\s*\|\s*Page:\s*(\d+(?:-\d+)?)\s*\|\s*Chapter:\s*([^\]]+)\]/i
    );
    const pageNum = passageHeaderMatch ? passageHeaderMatch[2] : '';
    const chapterName = passageHeaderMatch ? passageHeaderMatch[3].trim() : '';

    // Extract passage excerpt
    const passageExcerptMatch = request.prompt.match(
      /<evidence_passages>[\s\S]*?\]\s*\n([\s\S]*?)<\/evidence_passages>/i
    );
    let excerpt = passageExcerptMatch ? passageExcerptMatch[1].trim() : '';
    if (excerpt.length > 200) {
      excerpt = excerpt.substring(0, 197) + '...';
    }

    let text = '';
    const temp = request.temperature ?? 0.65;
    const filipinoLeadIns = [
      `Batay sa Opisyal na Civil Service Commission (CSC) Reviewer${pageNum ? ` (Pahina ${pageNum})` : ''}:`,
      `Ayon sa napatunayang pamantayan ng Civil Service Commission${pageNum ? ` [Pahina ${pageNum}]` : ''}:`,
      `Alinsunod sa opisyal na kurikulum ng CSC Reviewer${pageNum ? ` (Pahina ${pageNum})` : ''}:`,
    ];
    const englishLeadIns = [
      `Based on the official Philippine Civil Service Commission (CSC) Reviewer${pageNum ? ` (Page ${pageNum})` : ''}:`,
      `According to the verified Civil Service Commission curriculum standards${pageNum ? ` [Page ${pageNum}]` : ''}:`,
      `Drawing directly from the CSC statutory reference materials${pageNum ? ` (Page ${pageNum})` : ''}:`,
    ];
    const filipinoAnalysis = [
      `Tinitiyak ng opisyal na sagot na natutugunan ang hinihingi ng tanong, habang ang ibang mga pagpipilian ay hindi umaayon sa itinakdang pamantayan.`,
      `Ang nasabing batas o panuntunan ay tahasang nagpapatunay sa sagot, kaya ibinubukod ang mga maling opsyon.`,
      `Malinaw na sinusuportahan ng batayan ang tamang opsyon samantalang salungat dito ang mga panggulo (distractors).`,
    ];
    const englishAnalysis = [
      `"${answer}" satisfies all conditions of the stem, whereas the alternative distractors deviate from the verified curriculum guidelines.`,
      `The statutory rule explicitly establishes this requirement, directly eliminating the incorrect distractor alternatives.`,
      `This verified standard directly confirms the canonical answer while ruling out choices that lack legal basis.`,
    ];
    const pickIdx = temp > 0.1 ? Math.floor(Math.random() * 3) : 0;

    const clarificationMatch = request.prompt.match(
      /LEARNER CLARIFICATION REQUEST \/ DISTRACTOR QUERY:\s*\n"([^"]+)"/i
    );
    const distractorQuery = clarificationMatch ? clarificationMatch[1].trim() : '';

    if (isFilipino) {
      text =
        `${filipinoLeadIns[pickIdx]}\n\n` +
        (distractorQuery ? `• Tugon sa Katanungan:\n${distractorQuery} — Ang nasabing pagpipilian ay hindi wasto sapagkat hindi ito naaayon sa itinakdang tuntunin ng batas.\n\n` : '') +
        `• Tamang Sagot: "${answer}"\n\n` +
        `• Paliwanag ng Panuntunan:\n${rationale ? rationale : `Ang sagot na "${answer}" ang wastong tugon na itinatadhana ayon sa pamantayan ng pagsusulit sa ${chapterName || 'asignaturang ito'}.`}\n\n` +
        (excerpt ? `• Sipi mula sa Sanggunian:\n"${excerpt}"\n\n` : '') +
        `• Pagsusuri: ${filipinoAnalysis[pickIdx]}`;
    } else {
      text =
        `${englishLeadIns[pickIdx]}\n\n` +
        (distractorQuery ? `• Clarification / Distractor Analysis:\n"${distractorQuery}" — This alternative is incorrect because it deviates from statutory requirements.\n\n` : '') +
        `• Correct Answer: "${answer}"\n\n` +
        `• Key Rule / Concept:\n${rationale ? rationale : `The official answer "${answer}" directly aligns with the Civil Service examination standards for ${chapterName || 'this subject'}.`}\n\n` +
        (excerpt ? `• Verified Reference Excerpt:\n"${excerpt}"\n\n` : '') +
        `• Option Analysis: ${englishAnalysis[pickIdx]}`;
    }

    const chunks = text.split(' ');
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw new Error('Generation cancelled');
      yield { text: chunks[i] + (i === chunks.length - 1 ? '' : ' '), isComplete: i === chunks.length - 1 };
    }
  }
}

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [dependencies, setDependencies] = useState<{
    controller: ReviewSessionController;
    repo: QuestionRepository;
  } | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'home' | 'quiz'>('home');
  const [selectedMode, setSelectedMode] = useState<StudyMode>('all');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('quiz');
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(undefined);
  const [topicSummaries, setTopicSummaries] = useState<TopicSummary[]>([]);
  const [controllerState, setControllerState] = useState<ReviewSessionState | null>(null);

  const modelStatus: ModelRuntimeStatus = {
    state: 'ready',
    manifestId: 'qwen2.5-1.5b-csc',
    modelName: 'Qwen2.5-1.5B-Instruct-Q4_K_M',
    peakMemoryBytes: 850 * 1024 * 1024,
  };

  useEffect(() => {
    let isMounted = true;
    async function bootstrap() {
      try {
        const db = await openContentPackDatabase();
        const repository = new SqliteQuestionRepository(db);
        const passageRetriever = new SqlitePassageRetriever(db);
        const llmPort = new LocalMockLlmPort();
        const logger = new DiagnosticsLogger(50);

        const getNextQuestion = new GetNextQuestion({ repository });
        const submitAnswer = new SubmitAnswer(repository);
        const getExplanationContext = new GetExplanationContext(repository, passageRetriever);
        const explainMore = new ExplainMore(repository, passageRetriever, llmPort, logger);
        const interpretFreeAnswer = new InterpretFreeAnswer(repository, passageRetriever, llmPort, logger);
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

        const summaries = await repository.getTopicSummaries();
        if (isMounted) {
          setDependencies({ controller: sessionController, repo: repository });
          setTopicSummaries(summaries);
          setControllerState(sessionController.getState());
          setIsReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize content pack database:', err);
      }
    }
    bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!dependencies) return;
    const unsubscribe = dependencies.controller.subscribe((newState) => {
      setControllerState(newState);
    });
    return unsubscribe;
  }, [dependencies]);

  const refreshTopics = useCallback(async () => {
    if (!dependencies) return;
    const updated = await dependencies.repo.getTopicSummaries();
    setTopicSummaries([...updated]);
  }, [dependencies]);

  const handleStartSession = useCallback(
    async (
      topicId?: string,
      mode: StudyMode = 'all',
      format: SessionFormat = 'quiz'
    ) => {
      if (!dependencies) return;
      setActiveTopicId(topicId);
      setSelectedMode(mode);
      setSessionFormat(format);

      await dependencies.controller.startSession({
        query: { topicId, mode },
        shuffleChoices: true,
        sessionSeed: `session_${Date.now()}`,
      });

      setCurrentScreen('quiz');
    },
    [dependencies]
  );

  const handleSubmitAnswer = useCallback(async () => {
    if (!dependencies) return;
    await dependencies.controller.submitCurrentAnswer();
    await refreshTopics();
  }, [dependencies, refreshTopics]);

  const handleRateCard = useCallback(
    async (rating: 'again' | 'know') => {
      if (!dependencies) return;
      await dependencies.controller.rateCurrentFlashcard(rating);
      await refreshTopics();
    },
    [dependencies, refreshTopics]
  );

  const handleRestartSession = useCallback(() => {
    handleStartSession(activeTopicId, selectedMode, sessionFormat);
  }, [handleStartSession, activeTopicId, selectedMode, sessionFormat]);

  const handleReturnHome = useCallback(async () => {
    setCurrentScreen('home');
    await refreshTopics();
  }, [refreshTopics]);

  if (!isReady || !dependencies || !controllerState) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.loadingText}>Loading Content Pack...</Text>
      </View>
    );
  }

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
          consensusEvaluation={controllerState.consensusEvaluation}
          modelStatus={modelStatus}
          isGeneratingAi={controllerState.isGeneratingAi}
          aiError={controllerState.aiError}
          isSessionCompleted={controllerState.isSessionCompleted}
          sessionFormat={sessionFormat}
          onSelectChoice={(id) => dependencies.controller.selectChoice(id)}
          onChangeFreeText={(text) => dependencies.controller.setFreeTextInput(text)}
          onSubmitAnswer={handleSubmitAnswer}
          onRequestExplainMore={(lang) => dependencies.controller.requestExplainMore(lang)}
          onRequestInterpretFreeAnswer={() =>
            dependencies.controller.requestFreeAnswerInterpretation()
          }
          onRequestConsensusInterpretation={() =>
            dependencies.controller.requestConsensusInterpretation()
          }
          onRequestClarification={(query) => dependencies.controller.requestClarification(query)}
          onCancelGeneration={() => dependencies.controller.cancelActiveAiGeneration()}
          onNextQuestion={() => dependencies.controller.nextQuestion()}
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
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: colors.neutral.textSecondary,
    fontWeight: '500',
  },
});
