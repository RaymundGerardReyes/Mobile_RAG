import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  borders,
  colors,
  controls,
  radius,
  spacing,
  typography,
} from '../../theme/tokens.js';
import {
  AnimatedChoiceRow,
  AnimatedProgressBar,
  CSCButton,
  CSCChipBadge,
  ContentCard,
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
  onSelectChoice: (choiceId: string) => void;
  onChangeFreeText: (text: string) => void;
  onSubmitAnswer: () => void;
  onRequestExplainMore: (language: 'en' | 'fil') => void;
  onRequestInterpretFreeAnswer?: () => void;
  onCancelGeneration: () => void;
  onNextQuestion: () => void;
  onRestartSession?: () => void;
  onReturnHome?: () => void;
}

/**
 * Clean UI Screen for the Philippine Civil Service Exam Reviewer.
 * Adheres strictly to the 80/15/5 color policy, 100% WCAG AA contrast,
 * and accessible Apple HIG touch targets (>= 44pt).
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
  onSelectChoice,
  onChangeFreeText,
  onSubmitAnswer,
  onRequestExplainMore,
  onRequestInterpretFreeAnswer,
  onCancelGeneration,
  onNextQuestion,
  onRestartSession,
  onReturnHome,
}: QuizReviewScreenProps) {
  const [isInputFocused, setIsInputFocused] = useState(false);

  // 1. Session Completed State
  if (isSessionCompleted) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}
      >
        <ContentCard style={styles.completionCard}>
          <View style={styles.completionHeader}>
            <Text style={styles.completionEmoji}>🎉</Text>
            <Text style={styles.completionTitle}>Review Session Complete!</Text>
            <Text style={styles.completionSubtitle}>
              You have reviewed all {totalQuestions} question{totalQuestions === 1 ? '' : 's'} in this session.
            </Text>
          </View>

          <View style={styles.completionStatsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{totalQuestions}</Text>
              <Text style={styles.statLabel}>Total Reviewed</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>100%</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
          </View>

          <View style={styles.completionActions}>
            {onRestartSession && (
              <CSCButton
                title="Review Again"
                variant="primary"
                onPress={onRestartSession}
              />
            )}
            {onReturnHome && (
              <CSCButton
                title="Back to Dashboard"
                variant="secondary"
                onPress={onReturnHome}
              />
            )}
          </View>
        </ContentCard>
      </ScrollView>
    );
  }

  // 2. Uninitialized / Loading State (question is null before session starts)
  if (!question) {
    return (
      <View style={[styles.screen, styles.centerContainer]}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.loadingText}>Loading review session...</Text>
      </View>
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
    (isGeneratingAi && streamingAiText ? streamingAiText : null);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* 1. Top Meta Row: Progress + WCAG AA 5% Accent Red Difficulty & Page Badges */}
      <View style={styles.metaRow}>
        <Text style={styles.progressLabel}>
          Question {questionNumber} of {totalQuestions}
        </Text>
        <View style={styles.badgeGroup}>
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
      </View>

      {/* 2. Top Animated Progress Bar (200ms ease-out using native driver) */}
      <AnimatedProgressBar
        current={questionNumber}
        total={totalQuestions}
        height={6}
      />

      {/* 3. Question Stem Card (16pt radius, 1pt subtle border) */}
      <ContentCard style={styles.stemCard}>
        <Text style={styles.stemText}>{question.stem}</Text>

        {/* Multiple-Choice Options */}
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
          /* Free-Response / Identification Input */
          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>Your Answer</Text>
            <TextInput
              editable={!isAnswered}
              value={freeTextInput}
              onChangeText={onChangeFreeText}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder={
                question.questionType === 'essay'
                  ? 'Type your comprehensive explanation here...'
                  : 'Type your answer here...'
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

        {/* Primary Action Button (Submit or Next Question) */}
        <View style={styles.primaryActionContainer}>
          {!isAnswered ? (
            <CSCButton
              title="Submit Answer"
              variant="primary"
              disabled={!canSubmit}
              onPress={onSubmitAnswer}
            />
          ) : (
            <CSCButton
              title={questionNumber >= totalQuestions ? 'Finish Review' : 'Next Question'}
              variant="primary"
              onPress={onNextQuestion}
            />
          )}
        </View>
      </ContentCard>

      {/* 4. Post-Submission Deterministic Feedback & Grounded AI Explanation */}
      {isAnswered && submissionResult && (
        <ContentCard delayMs={60} style={styles.explanationCard}>
          {/* Deterministic Score Banner */}
          <View
            style={[
              styles.verdictBanner,
              submissionResult.isCorrect
                ? styles.verdictCorrect
                : submissionResult.score > 0
                ? styles.verdictPartial
                : styles.verdictIncorrect,
            ]}
          >
            <Text
              style={[
                styles.verdictTitle,
                {
                  color: submissionResult.isCorrect
                    ? colors.semantic.correct.text
                    : submissionResult.score > 0
                    ? colors.semantic.warning.text
                    : colors.semantic.incorrect.text,
                },
              ]}
            >
              {submissionResult.isCorrect
                ? '✓ Correct Answer'
                : submissionResult.score > 0
                ? `½ Partially Correct (${submissionResult.score * 100}%)`
                : `✕ Incorrect — Official Answer: ${
                    submissionResult.canonicalAnswer ?? 'See below'
                  }`}
            </Text>
          </View>

          {/* Official Canonical Rationale */}
          <Text style={styles.sectionHeading}>Official Rationale</Text>
          <Text style={styles.bodyText}>
            {submissionResult.canonicalExplanation ||
              'Refer to the verified textbook excerpts below.'}
          </Text>

          {/* Retrieved Passages (Tier 1 Linked or Tier 2 FTS5 BM25) */}
          {supportingPassages.length > 0 && (
            <View style={styles.passagesContainer}>
              <Text style={styles.metadataHeading}>
                Verified Textbook Evidence (pp. {sourcePages.join(', ')})
              </Text>
              {supportingPassages.map((item) => (
                <View key={item.passage.id} style={styles.passageItem}>
                  <Text style={styles.passageBody}>{item.passage.text}</Text>
                  <Text style={styles.passageMeta}>
                    {item.passage.chapter}
                    {item.passage.section ? ` • ${item.passage.section}` : ''} • pp.{' '}
                    {item.passage.startPage}–{item.passage.endPage} (
                    {item.strategy === 'linked' ? 'Verified Link' : 'FTS5 Search'})
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.divider} />

          {/* Feature B: Free-Answer Semantic Rubric Evaluation */}
          {question.questionType !== 'multiple_choice' && (
            <View style={styles.rubricContainer}>
              <Text style={styles.aiHeading}>AI Semantic Rubric Evaluation</Text>
              {freeAnswerEvaluation ? (
                <View style={styles.rubricResultCard}>
                  <View style={styles.rubricHeaderRow}>
                    <CSCChipBadge
                      label={
                        freeAnswerEvaluation.verdict === 'equivalent'
                          ? 'Equivalent (Full Credit)'
                          : freeAnswerEvaluation.verdict === 'partially_equivalent'
                          ? 'Partially Equivalent'
                          : freeAnswerEvaluation.verdict === 'ambiguous'
                          ? 'Ambiguous (Needs Review)'
                          : 'Incorrect'
                      }
                      variant={
                        freeAnswerEvaluation.verdict === 'equivalent'
                          ? 'success'
                          : freeAnswerEvaluation.verdict === 'partially_equivalent'
                          ? 'warning'
                          : freeAnswerEvaluation.verdict === 'ambiguous'
                          ? 'accentRed'
                          : 'neutral'
                      }
                    />
                    <Text style={styles.confidenceText}>
                      Confidence: {Math.round(freeAnswerEvaluation.confidence * 100)}%
                    </Text>
                  </View>

                  {freeAnswerEvaluation.matchedConcepts.length > 0 && (
                    <View style={styles.conceptSection}>
                      <Text style={styles.conceptSectionTitle}>Matched Concepts:</Text>
                      <View style={styles.conceptBadgeRow}>
                        {freeAnswerEvaluation.matchedConcepts.map((concept, cIdx) => (
                          <CSCChipBadge
                            key={`matched-${cIdx}`}
                            label={concept}
                            variant="success"
                          />
                        ))}
                      </View>
                    </View>
                  )}

                  {freeAnswerEvaluation.missingConcepts.length > 0 && (
                    <View style={styles.conceptSection}>
                      <Text style={styles.conceptSectionTitle}>Missing Concepts:</Text>
                      <View style={styles.conceptBadgeRow}>
                        {freeAnswerEvaluation.missingConcepts.map((concept, cIdx) => (
                          <CSCChipBadge
                            key={`missing-${cIdx}`}
                            label={concept}
                            variant="warning"
                          />
                        ))}
                      </View>
                    </View>
                  )}

                  {freeAnswerEvaluation.guardrailTriggered && (
                    <View style={styles.guardrailNotice}>
                      <Text style={styles.guardrailText}>
                        Guardrail Triggered: {freeAnswerEvaluation.guardrailTriggered}
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
                <View style={styles.rubricActionContainer}>
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
                </View>
              ) : null}
            </View>
          )}

          {/* Feature A: On-Device AI Elaboration Output */}
          {explanationText && (
            <View style={styles.aiBox}>
              <Text style={styles.aiHeading}>AI Tutor Explanation</Text>
              <Text style={styles.bodyText}>{explanationText}</Text>
            </View>
          )}

          {/* Semantic Error Notice */}
          {aiError && (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>[!] {aiError}</Text>
            </View>
          )}

          {/* ExplainMore / Cancel Controls */}
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
                />
                {!isModelUnavailable && (
                  <CSCButton
                    title="Ipaliwanag sa Filipino"
                    variant="secondary"
                    loading={isModelBusyLoading}
                    onPress={() => onRequestExplainMore('fil')}
                  />
                )}
              </View>
            )}
          </View>
        </ContentCard>
      )}
    </ScrollView>
  );
}

export interface ConnectedQuizReviewScreenProps {
  controller: ReviewSessionController;
  modelStatus?: ModelRuntimeStatus;
  onRestartSession?: () => void;
  onReturnHome?: () => void;
}

/**
 * Connected Container for QuizReviewScreen.
 * Subscribes to ReviewSessionController state changes and dispatches actions.
 */
export function ConnectedQuizReviewScreen({
  controller,
  modelStatus = { state: 'ready' },
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
      onSelectChoice={(choiceId) => controller.selectChoice(choiceId)}
      onChangeFreeText={(text) => controller.setFreeTextInput(text)}
      onSubmitAnswer={() => controller.submitCurrentAnswer()}
      onRequestExplainMore={(lang) => controller.requestExplainMore(lang)}
      onRequestInterpretFreeAnswer={() => controller.requestFreeAnswerInterpretation()}
      onCancelGeneration={() => controller.cancelActiveAiGeneration()}
      onNextQuestion={() => controller.nextQuestion()}
      onRestartSession={onRestartSession}
      onReturnHome={onReturnHome}
    />
  );
}

/**
 * Reusable Container alias matching architectural Pattern C.
 */
export const QuizSessionContainer = ConnectedQuizReviewScreen;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
  },
  contentContainer: {
    padding: spacing.base,
    paddingBottom: spacing.section,
    gap: spacing.base,
  },
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
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
  },
  badgeGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stemCard: {
    gap: spacing.base,
  },
  stemText: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    lineHeight: typography.headline.lineHeight,
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
    minHeight: controls.buttonHeight,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
    backgroundColor: colors.neutral.surfaceElevated,
    fontSize: typography.body.fontSize,
    color: colors.neutral.textPrimary,
  },
  textInputMultiline: {
    minHeight: 110,
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
  primaryActionContainer: {
    marginTop: spacing.xs,
  },
  explanationCard: {
    gap: spacing.md,
  },
  verdictBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
  },
  verdictCorrect: {
    borderColor: colors.semantic.correct.border,
    backgroundColor: colors.semantic.correct.surface,
  },
  verdictPartial: {
    borderColor: colors.semantic.warning.border,
    backgroundColor: colors.semantic.warning.surface,
  },
  verdictIncorrect: {
    borderColor: colors.semantic.incorrect.border,
    backgroundColor: colors.semantic.incorrect.surface,
  },
  verdictTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
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
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  metadataHeading: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
    textTransform: 'uppercase',
  },
  passageItem: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surface,
    gap: spacing.xs,
  },
  passageBody: {
    fontSize: typography.subheadline.fontSize,
    lineHeight: typography.subheadline.lineHeight,
    color: colors.neutral.textPrimary,
  },
  passageMeta: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  divider: {
    height: borders.hairline,
    backgroundColor: colors.neutral.borderSubtle,
    marginVertical: spacing.xs,
  },
  rubricContainer: {
    gap: spacing.sm,
  },
  rubricResultCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surfaceMuted,
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
  rubricActionContainer: {
    marginTop: spacing.xs,
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
    borderRadius: radius.md,
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
    gap: spacing.sm,
  },
  completionCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xl,
  },
  completionHeader: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  completionEmoji: {
    fontSize: 48,
  },
  completionTitle: {
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
    textAlign: 'center',
  },
  completionSubtitle: {
    fontSize: typography.body.fontSize,
    color: colors.neutral.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.base,
  },
  completionStatsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  statBox: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  statNumber: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  statLabel: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: spacing.xs,
  },
  completionActions: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.base,
  },
});
