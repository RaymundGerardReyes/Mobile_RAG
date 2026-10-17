import React, { useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { colors } from './src/theme/tokens.js';
import {
  ReviewHomeScreen,
  SessionFormat,
  StudyMode,
} from './src/features/review/ReviewHomeScreen.js';
import { QuizReviewScreen } from './src/features/quiz/QuizReviewScreen.js';
import { Question } from './src/domain/types.js';
import { TopicSummary } from './src/application/ports/question_repository.js';
import { ModelRuntimeStatus } from './src/application/ports/local_llm_port.js';
import {
  scoreExactIdentification,
  scoreMultipleChoice,
} from './src/domain/scoring.js';
import { SubmitAnswerResponse } from './src/application/use_cases/submit_answer.js';
import { RetrievedPassage } from './src/application/ports/passage_retriever.js';

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

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'quiz'>('home');
  const [selectedMode, setSelectedMode] = useState<StudyMode>('all');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('quiz');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [freeTextInput, setFreeTextInput] = useState('');
  const [submissionResult, setSubmissionResult] =
    useState<SubmitAnswerResponse | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);

  const modelStatus: ModelRuntimeStatus = { state: 'ready' };

  const currentQuestion = SAMPLE_QUESTIONS[questionIndex] || null;
  const currentPassages = currentQuestion
    ? SAMPLE_PASSAGES[currentQuestion.id] || []
    : [];
  const sourcePages = currentQuestion ? [currentQuestion.sourcePage] : [];

  const handleStartSession = (
    _topicId?: string,
    mode?: StudyMode,
    format: SessionFormat = 'quiz'
  ) => {
    if (mode) setSelectedMode(mode);
    setSessionFormat(format);
    setQuestionIndex(0);
    setSelectedChoiceId(null);
    setFreeTextInput('');
    setSubmissionResult(null);
    setAiExplanation(null);
    setAiError(null);
    setIsSessionCompleted(false);
    setCurrentScreen('quiz');
  };

  const handleSubmitAnswer = () => {
    if (!currentQuestion) return;

    if (currentQuestion.questionType === 'multiple_choice') {
      if (!selectedChoiceId) return;
      const scoreResult = scoreMultipleChoice(
        currentQuestion,
        selectedChoiceId
      );
      setSubmissionResult({
        attempt: {
          id: `att-${Date.now()}`,
          questionId: currentQuestion.id,
          selectedChoiceId,
          isCorrect: scoreResult.isCorrect,
          score: scoreResult.score,
          durationMs: 1500,
          answeredAt: new Date().toISOString(),
        },
        isCorrect: scoreResult.isCorrect,
        score: scoreResult.score,
        canonicalChoiceId: currentQuestion.canonicalChoiceId ?? null,
        canonicalAnswer: currentQuestion.canonicalAnswer ?? null,
        canonicalExplanation: currentQuestion.canonicalExplanation ?? null,
      });
    } else {
      const scoreResult = scoreExactIdentification(
        currentQuestion.canonicalAnswer,
        freeTextInput
      );
      setSubmissionResult({
        attempt: {
          id: `att-${Date.now()}`,
          questionId: currentQuestion.id,
          freeTextAnswer: freeTextInput,
          isCorrect: scoreResult.isCorrect,
          score: scoreResult.score,
          durationMs: 2000,
          answeredAt: new Date().toISOString(),
        },
        isCorrect: scoreResult.isCorrect,
        score: scoreResult.score,
        canonicalChoiceId: currentQuestion.canonicalChoiceId ?? null,
        canonicalAnswer: currentQuestion.canonicalAnswer ?? null,
        canonicalExplanation: currentQuestion.canonicalExplanation ?? null,
      });
    }
  };

  const handleRequestExplainMore = (language: 'en' | 'fil') => {
    if (!currentQuestion) return;
    setIsGeneratingAi(true);
    setAiError(null);
    setTimeout(() => {
      setIsGeneratingAi(false);
      if (language === 'fil') {
        setAiExplanation(
          `Ayon sa Batas (Pahina ${currentQuestion.sourcePage}), ang opisyal na paliwanag ay: "${currentQuestion.canonicalExplanation}". Ito ay nakapaloob sa mga alituntunin ng Komisyon sa Serbisyo Sibil.`
        );
      } else {
        setAiExplanation(
          `Grounded on official reference (Page ${currentQuestion.sourcePage}): "${currentQuestion.canonicalExplanation}". This policy is strictly tested in the Philippine Civil Service Examination.`
        );
      }
    }, 600);
  };

  const handleNextQuestion = () => {
    if (questionIndex + 1 < SAMPLE_QUESTIONS.length) {
      setQuestionIndex(questionIndex + 1);
      setSelectedChoiceId(null);
      setFreeTextInput('');
      setSubmissionResult(null);
      setAiExplanation(null);
      setAiError(null);
    } else {
      setIsSessionCompleted(true);
    }
  };

  const handleRestartSession = () => {
    handleStartSession(undefined, selectedMode, sessionFormat);
  };

  const handleReturnHome = () => {
    setCurrentScreen('home');
    setIsSessionCompleted(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      {currentScreen === 'home' ? (
        <ReviewHomeScreen
          topicSummaries={INITIAL_TOPICS}
          selectedMode={selectedMode}
          modelStatus={modelStatus}
          onSelectMode={setSelectedMode}
          onStartSession={handleStartSession}
        />
      ) : (
        <QuizReviewScreen
          question={currentQuestion}
          questionNumber={questionIndex + 1}
          totalQuestions={SAMPLE_QUESTIONS.length}
          selectedChoiceId={selectedChoiceId}
          freeTextInput={freeTextInput}
          submissionResult={submissionResult}
          supportingPassages={currentPassages}
          sourcePages={sourcePages}
          aiExplanation={aiExplanation}
          modelStatus={modelStatus}
          isGeneratingAi={isGeneratingAi}
          aiError={aiError}
          isSessionCompleted={isSessionCompleted}
          sessionFormat={sessionFormat}
          onSelectChoice={setSelectedChoiceId}
          onChangeFreeText={setFreeTextInput}
          onSubmitAnswer={handleSubmitAnswer}
          onRequestExplainMore={handleRequestExplainMore}
          onCancelGeneration={() => setIsGeneratingAi(false)}
          onNextQuestion={handleNextQuestion}
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

