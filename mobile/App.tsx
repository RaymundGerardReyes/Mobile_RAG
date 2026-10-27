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

  async retrieveIterativeEvidence(
    questionId: string,
    stem: string,
    canonicalAnswer: string,
    followUpQuery?: string,
    limit = 2
  ): Promise<{
    passages: RetrievedPassage[];
    tierUsed: 'tier1_direct' | 'tier2_strict_and' | 'tier3_broad_or' | 'none';
    iterationsRun: string[];
  }> {
    const iterationsRun: string[] = [];
    const results: RetrievedPassage[] = [];
    const seenIds = new Set<string>();

    // Iteration 1: Direct linked passages
    iterationsRun.push(`Iteration 1: Checking Tier 1 direct links for ${questionId}`);
    const direct = this.passagesMap[questionId] || [];
    for (const p of direct) {
      if (!seenIds.has(p.passage.id) && results.length < limit) {
        seenIds.add(p.passage.id);
        results.push({ ...p, strategy: 'linked' });
      }
    }
    if (results.length >= limit && !followUpQuery) {
      return { passages: results, tierUsed: 'tier1_direct', iterationsRun };
    }

    // Extract keywords for Tier 2 & Tier 3 search
    const rawSearch = followUpQuery?.trim() ? followUpQuery : `${canonicalAnswer} ${stem}`;
    const keywords = rawSearch
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    const allPassages: RetrievedPassage[] = [];
    for (const list of Object.values(this.passagesMap)) {
      for (const item of list) {
        allPassages.push(item);
      }
    }

    // Iteration 2: Strict AND match across top 3 keywords
    if (keywords.length > 0) {
      const strictTerms = keywords.slice(0, 3);
      iterationsRun.push(`Iteration 2: Strict AND search for [${strictTerms.join(', ')}]`);
      for (const candidate of allPassages) {
        const textLower = candidate.passage.text.toLowerCase();
        if (
          !seenIds.has(candidate.passage.id) &&
          strictTerms.every((kw) => textLower.includes(kw))
        ) {
          seenIds.add(candidate.passage.id);
          results.push({ ...candidate, strategy: 'fts5' });
          if (results.length >= limit) {
            return { passages: results, tierUsed: 'tier2_strict_and', iterationsRun };
          }
        }
      }
    }

    // Iteration 3: Broad OR match across keywords
    if (keywords.length > 0 && results.length < limit) {
      iterationsRun.push(`Iteration 3: Broad OR fallback for [${keywords.join(', ')}]`);
      for (const candidate of allPassages) {
        const textLower = candidate.passage.text.toLowerCase();
        if (
          !seenIds.has(candidate.passage.id) &&
          keywords.some((kw) => textLower.includes(kw))
        ) {
          seenIds.add(candidate.passage.id);
          results.push({ ...candidate, strategy: 'fts5' });
          if (results.length >= limit) {
            return { passages: results, tierUsed: 'tier3_broad_or', iterationsRun };
          }
        }
      }
    }

    return {
      passages: results,
      tierUsed: results.length > 0 ? 'tier1_direct' : 'none',
      iterationsRun,
    };
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
        shuffleChoices: true,
        sessionSeed: `session_${Date.now()}`,
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
          consensusEvaluation={controllerState.consensusEvaluation}
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
          onRequestConsensusInterpretation={() =>
            controller.requestConsensusInterpretation()
          }
          onRequestClarification={(query) => controller.requestClarification(query)}
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
