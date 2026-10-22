import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  borders,
  colors,
  controls,
  elevation,
  radius,
  spacing,
  typography,
} from '../../theme/tokens.js';
import {
  AnimatedChoiceRow,
  AnimatedProgressBar,
  AnswerFeedbackBanner,
  BottomActionBar,
  CSCButton,
  CSCChipBadge,
  ContentCard,
  EvidenceCard,
  Flashcard,
  LiquidGlassTopBar,
  ScreenContainer,
  ScreenHeader,
} from '../../components/CorePrimitives.js';
import { Choice, Question } from '../../domain/types.js';
import { ModelRuntimeStatus } from '../../application/ports/local_llm_port.js';
import { RetrievedPassage } from '../../application/ports/passage_retriever.js';
import { SubmitAnswerResponse } from '../../application/use_cases/submit_answer.js';
import { ExplainMoreResponse } from '../../application/use_cases/explain_more.js';
import { ValidatedVerdictResult } from '../../ai/evaluation/output_validator.js';
import {
  ReviewSessionController,
  ReviewSessionState,
} from '../../controllers/review_session_controller.js';
import { SessionFormat } from '../review/ReviewHomeScreen.js';

export interface QuizReviewScreenProps {
  question: Question | null;
  questionNumber: number;
  totalQuestions: number;
  selectedChoiceId: string | null;
  freeTextInput: string;
  submissionResult: SubmitAnswerResponse | null;
  supportingPassages: RetrievedPassage[];
  sourcePages: number[];
  aiExplanation: string | ExplainMoreResponse | null;
  streamingAiText?: string;
  freeAnswerEvaluation?: ValidatedVerdictResult | null;
  modelStatus: ModelRuntimeStatus;
  isGeneratingAi: boolean;
  aiError: string | null;
  isSessionCompleted?: boolean;
  sessionFormat?: SessionFormat;
  onSelectChoice: (choiceId: string) => void;
  onChangeFreeText: (text: string) => void;
  onSubmitAnswer: () => void;
  onRequestExplainMore: (language: 'en' | 'fil') => void;
  onRequestInterpretFreeAnswer?: () => void;
  onCancelGeneration: () => void;
  onNextQuestion: () => void;
  onRateCard?: (rating: 'again' | 'know') => void;
  onRestartSession?: () => void;
  onReturnHome?: () => void;
}

/**
 * Editorial, distraction-free Quiz and Flashcard Study Screen for iPhone 16.
 * Follows the exact learning sequence:
 * Question displayed -> Answer selected -> Submitted -> Feedback & Explanation read -> Next Question.
 */
export function QuizReviewScreen({
  question,
  questionNumber,
  totalQuestions,
  selectedChoiceId,
  freeTextInput,
  submissionResult,
  supportingPassages,
  sourcePages,
  aiExplanation,
  streamingAiText,
  freeAnswerEvaluation,
  modelStatus,
  isGeneratingAi,
  aiError,
  isSessionCompleted = false,
  sessionFormat = 'quiz',
  onSelectChoice,
  onChangeFreeText,
  onSubmitAnswer,
  onRequestExplainMore,
  onRequestInterpretFreeAnswer,
  onCancelGeneration,
  onNextQuestion,
  onRateCard,
  onRestartSession,
  onReturnHome,
}: QuizReviewScreenProps) {
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isFlashcardRevealed, setIsFlashcardRevealed] = useState(false);
  const [isRatingCard, setIsRatingCard] = useState(false);

  // Reset flashcard reveal state when advancing to a new question
  useEffect(() => {
    setIsFlashcardRevealed(false);
    setIsRatingCard(false);
  }, [question?.id, questionNumber]);

  // 1. Session Completed Summary View (No decorative emojis or fake charts)
  if (isSessionCompleted) {
    return (
      <ScreenContainer
        header={
          <LiquidGlassTopBar
            title="Session Summary"
            subtitle="Civil Service Review"
            onBack={onReturnHome}
            backLabel="Home"
          />
        }
        footer={
          <BottomActionBar>
            <View style={styles.summaryActions}>
              {onRestartSession && (
                <CSCButton
                  title="Study Again"
                  variant="primary"
                  onPress={onRestartSession}
                />
              )}
              {onReturnHome && (
                <CSCButton
                  title="Return to Today’s Study"
                  variant="secondary"
                  onPress={onReturnHome}
                />
              )}
            </View>
          </BottomActionBar>
        }
      >
        <View style={styles.summarySurface}>
          <Text style={styles.summaryOverline}>SESSION COMPLETE</Text>
          <Text style={styles.summaryTitle}>
            {totalQuestions} of {totalQuestions} Completed
          </Text>
          <Text style={styles.summarySubtitle}>
            You have completed all items in this study session. Review any
            challenging concepts or return to your subject list to continue
            practicing.
          </Text>

          <View style={styles.summaryMetricsRow}>
            <View style={styles.summaryMetricBox}>
              <Text style={styles.summaryMetricNumber}>{totalQuestions}</Text>
              <Text style={styles.summaryMetricLabel}>Questions Reviewed</Text>
            </View>
            <View style={styles.summaryMetricDivider} />
            <View style={styles.summaryMetricBox}>
              <Text style={styles.summaryMetricNumber}>100%</Text>
              <Text style={styles.summaryMetricLabel}>Session Progress</Text>
            </View>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  // 2. Loading State
  if (!question) {
    return (
      <ScreenContainer scrollable={false}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.brand.primary} />
          <Text style={styles.loadingText}>Preparing study session...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const isAnswered = submissionResult !== null;
  const canSubmit =
    question.questionType === 'multiple_choice'
      ? Boolean(selectedChoiceId)
      : freeTextInput.trim().length > 0;

  const isModelUnavailable = modelStatus.state === 'missing';
  const isModelBusyLoading =
    modelStatus.state === 'loading' || modelStatus.state === 'verifying';

  const explanationText =
    (typeof aiExplanation === 'string'
      ? aiExplanation
      : aiExplanation?.explanation || null) ||
    (streamingAiText ? streamingAiText : null);

  const canonicalAnswerDisplay =
    question.choices.find((c) => c.id === question.canonicalChoiceId)?.text ||
    question.canonicalAnswer ||
    'See explanation';

  const progressPercent =
    totalQuestions > 0
      ? Math.round((questionNumber / totalQuestions) * 100)
      : 0;

  // 3. Dedicated Flashcard Study Session View
  if (sessionFormat === 'flashcards') {
    return (
      <ScreenContainer
        header={
          <LiquidGlassTopBar
            title={`Card ${questionNumber} of ${totalQuestions}`}
            subtitle="Flashcard Recall"
            onBack={onReturnHome}
            backLabel="Exit"
            rightElement={
              <Text style={styles.progressPercentText}>{progressPercent}%</Text>
            }
          />
        }
        footer={
          <BottomActionBar>
            {!isFlashcardRevealed ? (
              <CSCButton
                title="Reveal Answer"
                variant="primary"
                onPress={() => setIsFlashcardRevealed(true)}
              />
            ) : (
              <View style={styles.flashcardRatingRow}>
                <CSCButton
                  title="Review Again"
                  variant="secondary"
                  disabled={isRatingCard}
                  onPress={async () => {
                    setIsRatingCard(true);
                    setIsFlashcardRevealed(false);
                    try {
                      if (onRateCard) {
                        await onRateCard('again');
                      } else {
                        onNextQuestion();
                      }
                    } finally {
                      setIsRatingCard(false);
                    }
                  }}
                  style={styles.flexButton}
                />
                <CSCButton
                  title="Know It"
                  variant="primary"
                  disabled={isRatingCard}
                  onPress={async () => {
                    setIsRatingCard(true);
                    setIsFlashcardRevealed(false);
                    try {
                      if (onRateCard) {
                        await onRateCard('know');
                      } else {
                        onNextQuestion();
                      }
                    } finally {
                      setIsRatingCard(false);
                    }
                  }}
                  style={styles.flexButton}
                />
              </View>
            )}
          </BottomActionBar>
        }
      >
        <AnimatedProgressBar
          current={questionNumber}
          total={totalQuestions}
          height={4}
        />
        <Flashcard
          topicTitle={question.topicId.replace(/-/g, ' ')}
          questionStem={question.stem}
          canonicalAnswer={canonicalAnswerDisplay}
          canonicalExplanation={question.canonicalExplanation}
          sourcePage={question.sourcePage}
          revealed={isFlashcardRevealed}
          onToggleReveal={() => setIsFlashcardRevealed(!isFlashcardRevealed)}
        />
      </ScreenContainer>
    );
  }

  // 4. Focused Practice Quiz View
  return (
    <ScreenContainer
      header={
        <LiquidGlassTopBar
          title={`Question ${questionNumber} of ${totalQuestions}`}
          subtitle="Practice Quiz"
          onBack={onReturnHome}
          backLabel="Exit"
          rightElement={
            <View style={styles.headerBadges}>
              {question.difficulty && (
                <CSCChipBadge
                  label={question.difficulty.toUpperCase()}
                  variant="accentRed"
                  indicatorDot
                />
              )}
              <CSCChipBadge
                label={`p. ${question.sourcePage}`}
                variant="neutral"
              />
            </View>
          }
        />
      }
      footer={
        <BottomActionBar>
          {!isAnswered ? (
            <CSCButton
              title="Submit Answer"
              variant="primary"
              disabled={!canSubmit}
              onPress={onSubmitAnswer}
            />
          ) : (
            <CSCButton
              title={
                questionNumber >= totalQuestions
                  ? 'Finish Review →'
                  : 'Next Question →'
              }
              variant="primary"
              onPress={onNextQuestion}
            />
          )}
        </BottomActionBar>
      }
    >
      {/* Compact Session Progress Bar */}
      <AnimatedProgressBar
        current={questionNumber}
        total={totalQuestions}
        height={4}
      />

      {/* Editorial Question Stem */}
      <View style={styles.questionSection}>
        <Text style={styles.instructionCaption}>
          {question.questionType === 'multiple_choice'
            ? 'Choose one answer.'
            : 'Type your exact identification answer.'}
        </Text>
        <Text style={styles.stemText}>{question.stem}</Text>
      </View>

      {/* Answer Choices or Free-Text Input */}
      {question.questionType === 'multiple_choice' ? (
        <View style={styles.choicesList}>
          {question.choices.map((choice: Choice, idx: number) => {
            const isSelected = selectedChoiceId === choice.id;
            const isCanonical =
              isAnswered && submissionResult?.canonicalChoiceId === choice.id;
            const isWrongSelection =
              isAnswered && isSelected && !submissionResult?.isCorrect;

            return (
              <AnimatedChoiceRow
                key={choice.id}
                choiceKey={choice.choiceKey}
                text={choice.text}
                selected={isSelected}
                disabled={isAnswered}
                isCorrect={isCanonical}
                isIncorrect={isWrongSelection}
                index={idx}
                onPress={() => onSelectChoice(choice.id)}
              />
            );
          })}
        </View>
      ) : (
        <View style={styles.formGroup}>
          <Text style={styles.inputLabel}>Your Response</Text>
          <TextInput
            editable={!isAnswered}
            value={freeTextInput}
            onChangeText={onChangeFreeText}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            placeholder={
              question.questionType === 'essay'
                ? 'Type your comprehensive explanation here...'
                : 'Type your official answer here...'
            }
            placeholderTextColor={colors.neutral.textMuted}
            multiline
            textAlignVertical="top"
            style={[
              styles.textInput,
              question.questionType === 'essay' && styles.textInputMultiline,
              isInputFocused && !isAnswered && styles.textInputFocused,
              isAnswered && styles.textInputDisabled,
            ]}
          />
        </View>
      )}

      {/* Post-Submission Feedback & Normal-Flow Explanation Section */}
      {isAnswered && submissionResult && (
        <View style={styles.explanationSection}>
          {/* Semantic Correct/Incorrect Verdict Banner */}
          <AnswerFeedbackBanner
            isCorrect={submissionResult.isCorrect}
            score={submissionResult.score}
            canonicalAnswer={submissionResult.canonicalAnswer}
          />

          {/* Why This Is Correct (Official Canonical Rationale) */}
          <ContentCard
            overline="Verified Official Rationale"
            title="Why this is correct"
          >
            <Text style={styles.bodyText}>
              {submissionResult.canonicalExplanation ||
                'Refer to the verified textbook excerpts below.'}
            </Text>
          </ContentCard>

          {/* Supporting Textbook Evidence Passages */}
          {supportingPassages.length > 0 && (
            <View style={styles.passagesContainer}>
              <Text style={styles.metadataHeading}>
                {sourcePages.length > 0
                  ? `VERIFIED TEXTBOOK REFERENCE (PP. ${sourcePages.join(', ')})`
                  : 'VERIFIED TEXTBOOK REFERENCE'}
              </Text>
              {supportingPassages.map((item) => (
                <EvidenceCard key={item.passage.id} retrievedPassage={item} />
              ))}
            </View>
          )}

          {/* Free-Answer Semantic Rubric Evaluation */}
          {question.questionType !== 'multiple_choice' && (
            <View style={styles.rubricContainer}>
              <View style={styles.divider} />
              <Text style={styles.aiHeading}>AI Semantic Rubric Evaluation</Text>
              {freeAnswerEvaluation ? (
                <View style={styles.rubricResultCard}>
                  <View style={styles.rubricHeaderRow}>
                    <CSCChipBadge
                      label={
                        freeAnswerEvaluation.verdict === 'equivalent'
                          ? 'Equivalent (Full Credit)'
                          : freeAnswerEvaluation.verdict ===
                            'partially_equivalent'
                          ? 'Partially Equivalent'
                          : freeAnswerEvaluation.verdict === 'ambiguous'
                          ? 'Ambiguous (Needs Review)'
                          : 'Incorrect'
                      }
                      variant={
                        freeAnswerEvaluation.verdict === 'equivalent'
                          ? 'success'
                          : freeAnswerEvaluation.verdict ===
                            'partially_equivalent'
                          ? 'warning'
                          : freeAnswerEvaluation.verdict === 'ambiguous'
                          ? 'accentRed'
                          : 'neutral'
                      }
                    />
                    <Text style={styles.confidenceText}>
                      Confidence:{' '}
                      {Math.round(freeAnswerEvaluation.confidence * 100)}%
                    </Text>
                  </View>

                  {freeAnswerEvaluation.matchedConcepts.length > 0 && (
                    <View style={styles.conceptSection}>
                      <Text style={styles.conceptSectionTitle}>
                        Matched Concepts:
                      </Text>
                      <View style={styles.conceptBadgeRow}>
                        {freeAnswerEvaluation.matchedConcepts.map(
                          (concept, cIdx) => (
                            <CSCChipBadge
                              key={`matched-${cIdx}`}
                              label={concept}
                              variant="success"
                            />
                          )
                        )}
                      </View>
                    </View>
                  )}

                  {freeAnswerEvaluation.missingConcepts.length > 0 && (
                    <View style={styles.conceptSection}>
                      <Text style={styles.conceptSectionTitle}>
                        Missing Concepts:
                      </Text>
                      <View style={styles.conceptBadgeRow}>
                        {freeAnswerEvaluation.missingConcepts.map(
                          (concept, cIdx) => (
                            <CSCChipBadge
                              key={`missing-${cIdx}`}
                              label={concept}
                              variant="warning"
                            />
                          )
                        )}
                      </View>
                    </View>
                  )}

                  {freeAnswerEvaluation.guardrailTriggered && (
                    <View style={styles.guardrailNotice}>
                      <Text style={styles.guardrailText}>
                        Guardrail Triggered:{' '}
                        {freeAnswerEvaluation.guardrailTriggered}
                      </Text>
                    </View>
                  )}

                  {freeAnswerEvaluation.requiresManualReview && (
                    <View style={styles.manualReviewNotice}>
                      <Text style={styles.manualReviewText}>
                        Manual Review Recommended
                      </Text>
                    </View>
                  )}
                </View>
              ) : onRequestInterpretFreeAnswer ? (
                <CSCButton
                  title={
                    isModelUnavailable
                      ? 'Offline Model Not Installed'
                      : 'Evaluate Answer with AI Rubric'
                  }
                  variant="secondary"
                  loading={isGeneratingAi || isModelBusyLoading}
                  disabled={isModelUnavailable || isGeneratingAi}
                  onPress={onRequestInterpretFreeAnswer}
                />
              ) : null}
            </View>
          )}

          {/* On-Device AI Elaboration Output */}
          <View style={styles.divider} />
          {(explanationText || isGeneratingAi) && (
            <ContentCard
              overline="On-Device Intelligence"
              title="AI Tutor Explanation"
              rightBadge={
                isGeneratingAi ? (
                  <CSCChipBadge label="Generating..." variant="brand" indicatorDot />
                ) : (
                  <CSCChipBadge label="Grounded RAG" variant="success" />
                )
              }
            >
              <Text style={styles.bodyText}>
                {explanationText || 'Generating grounded explanation...'}
              </Text>
            </ContentCard>
          )}

          {aiError && (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>! {aiError}</Text>
            </View>
          )}

          {/* Bilingual AI Tutor Controls */}
          <View style={styles.aiControlsRow}>
            {isGeneratingAi ? (
              <CSCButton
                title="Stop Generating"
                variant="secondary"
                onPress={onCancelGeneration}
              />
            ) : (
              <View style={styles.languageButtonGroup}>
                <CSCButton
                  title={
                    isModelUnavailable
                      ? 'Offline AI Model Not Installed'
                      : 'Explain in English'
                  }
                  variant="secondary"
                  loading={isModelBusyLoading}
                  disabled={isModelUnavailable}
                  onPress={() => onRequestExplainMore('en')}
                  style={styles.flexButton}
                />
                {!isModelUnavailable && (
                  <CSCButton
                    title="Ipaliwanag sa Filipino"
                    variant="secondary"
                    loading={isModelBusyLoading}
                    onPress={() => onRequestExplainMore('fil')}
                    style={styles.flexButton}
                  />
                )}
              </View>
            )}
          </View>
        </View>
      )}
    </ScreenContainer>
  );
}

export interface ConnectedQuizReviewScreenProps {
  controller: ReviewSessionController;
  modelStatus?: ModelRuntimeStatus;
  sessionFormat?: SessionFormat;
  onRestartSession?: () => void;
  onReturnHome?: () => void;
}

/**
 * Connected Container for QuizReviewScreen.
 */
export function ConnectedQuizReviewScreen({
  controller,
  modelStatus = { state: 'ready' },
  sessionFormat = 'quiz',
  onRestartSession,
  onReturnHome,
}: ConnectedQuizReviewScreenProps) {
  const [state, setState] = useState<ReviewSessionState>(controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, [controller]);

  return (
    <QuizReviewScreen
      question={state.currentQuestion}
      questionNumber={state.currentIndex + 1}
      totalQuestions={state.totalQuestions}
      selectedChoiceId={state.selectedChoiceId}
      freeTextInput={state.freeTextInput}
      submissionResult={state.submissionResult}
      supportingPassages={state.supportingPassages}
      sourcePages={state.sourcePages}
      aiExplanation={state.aiExplanation}
      streamingAiText={state.streamingAiText}
      freeAnswerEvaluation={state.freeAnswerEvaluation}
      modelStatus={modelStatus}
      isGeneratingAi={state.isGeneratingAi}
      aiError={state.aiError}
      isSessionCompleted={state.isSessionCompleted}
      sessionFormat={sessionFormat}
      onSelectChoice={(choiceId) => controller.selectChoice(choiceId)}
      onChangeFreeText={(text) => controller.setFreeTextInput(text)}
      onSubmitAnswer={() => controller.submitCurrentAnswer()}
      onRequestExplainMore={(lang) => controller.requestExplainMore(lang)}
      onRequestInterpretFreeAnswer={() =>
        controller.requestFreeAnswerInterpretation()
      }
      onCancelGeneration={() => controller.cancelActiveAiGeneration()}
      onNextQuestion={() => controller.nextQuestion()}
      onRateCard={(rating) => controller.rateCurrentFlashcard(rating)}
      onRestartSession={onRestartSession}
      onReturnHome={onReturnHome}
    />
  );
}

export const QuizSessionContainer = ConnectedQuizReviewScreen;

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.base,
  },
  loadingText: {
    fontSize: typography.body.fontSize,
    color: colors.neutral.textSecondary,
    fontWeight: '500',
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  progressPercentText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  questionSection: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  instructionCaption: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '500',
    color: colors.neutral.textSecondary,
  },
  stemText: {
    fontSize: typography.title2.fontSize, // 21pt strong editorial question stem
    lineHeight: 29,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  choicesList: {
    gap: spacing.md,
  },
  formGroup: {
    gap: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  textInput: {
    minHeight: 56,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
    backgroundColor: colors.neutral.surfaceElevated,
    fontSize: typography.body.fontSize,
    color: colors.neutral.textPrimary,
  },
  textInputMultiline: {
    minHeight: 120,
    paddingTop: spacing.md,
  },
  textInputFocused: {
    borderColor: colors.brand.primary,
    borderWidth: borders.focused,
  },
  textInputDisabled: {
    backgroundColor: colors.neutral.surfaceMuted,
    color: colors.neutral.textSecondary,
  },
  explanationSection: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.card,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.xl,
    gap: spacing.base,
    ...elevation.card,
  },
  rationaleBlock: {
    gap: spacing.xs,
  },
  sectionHeading: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  bodyText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.neutral.textPrimary,
  },
  passagesContainer: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metadataHeading: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.neutral.textSecondary,
    letterSpacing: 0.5,
  },
  passageItem: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.primary,
    backgroundColor: colors.neutral.surface,
    gap: spacing.xs,
  },
  passageBody: {
    fontSize: typography.callout.fontSize,
    lineHeight: typography.callout.lineHeight,
    color: colors.neutral.textPrimary,
  },
  passageMeta: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  divider: {
    height: borders.hairline,
    backgroundColor: colors.neutral.divider,
    marginVertical: spacing.xs,
  },
  rubricContainer: {
    gap: spacing.sm,
  },
  rubricResultCard: {
    padding: spacing.md,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surface,
    gap: spacing.sm,
  },
  rubricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confidenceText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
  },
  conceptSection: {
    gap: spacing.xs,
  },
  conceptSectionTitle: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  conceptBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  guardrailNotice: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.semantic.warning.surface,
  },
  guardrailText: {
    fontSize: typography.caption.fontSize,
    color: colors.semantic.warning.text,
    fontWeight: '600',
  },
  manualReviewNotice: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.brand.tint,
    borderWidth: borders.hairline,
    borderColor: colors.brand.border,
  },
  manualReviewText: {
    fontSize: typography.caption.fontSize,
    color: colors.brand.primary,
    fontWeight: '600',
  },
  aiBox: {
    gap: spacing.xs,
  },
  aiHeading: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.semantic.incorrect.border,
    backgroundColor: colors.semantic.incorrect.surface,
  },
  errorText: {
    fontSize: typography.subheadline.fontSize,
    color: colors.semantic.incorrect.text,
    fontWeight: '500',
  },
  aiControlsRow: {
    marginTop: spacing.xs,
  },
  languageButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
    minWidth: 140,
  },
  flashcardRatingRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summarySurface: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.card,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.xxl,
    gap: spacing.md,
    ...elevation.card,
  },
  summaryOverline: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
    letterSpacing: 0.6,
  },
  summaryTitle: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  summarySubtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.neutral.textSecondary,
  },
  summaryMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.neutral.divider,
  },
  summaryMetricBox: {
    alignItems: 'center',
    flex: 1,
  },
  summaryMetricDivider: {
    width: borders.hairline,
    height: 36,
    backgroundColor: colors.neutral.divider,
  },
  summaryMetricNumber: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  summaryMetricLabel: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: spacing.xs,
  },
  summaryActions: {
    gap: spacing.sm,
  },
});

