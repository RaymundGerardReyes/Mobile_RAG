import React from 'react';
import {
  Pressable,
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
import { CSCButton, ContentCard } from '../../components/CorePrimitives.js';
import { Choice, Question } from '../../domain/types.js';
import { ModelRuntimeStatus } from '../../application/ports/local_llm_port.js';
import { RetrievedPassage } from '../../application/ports/passage_retriever.js';
import { SubmitAnswerResponse } from '../../application/use_cases/submit_answer.js';
import { ExplainMoreResponse } from '../../application/use_cases/explain_more.js';

export interface QuizReviewScreenProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  selectedChoiceId: string | null;
  freeTextInput: string;
  submissionResult: SubmitAnswerResponse | null;
  supportingPassages: RetrievedPassage[];
  sourcePages: number[];
  aiExplanation: ExplainMoreResponse | null;
  modelStatus: ModelRuntimeStatus;
  isGeneratingAi: boolean;
  aiError: string | null;
  onSelectChoice: (choiceId: string) => void;
  onChangeFreeText: (text: string) => void;
  onSubmitAnswer: () => void;
  onRequestExplainMore: (language: 'en' | 'fil') => void;
  onCancelGeneration: () => void;
  onNextQuestion: () => void;
}

/**
 * Clean UI Screen for the Philippine Civil Service Exam Reviewer.
 * Adheres strictly to the 80/15/5 color policy and accessible Apple HIG touch targets.
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
  modelStatus,
  isGeneratingAi,
  aiError,
  onSelectChoice,
  onChangeFreeText,
  onSubmitAnswer,
  onRequestExplainMore,
  onCancelGeneration,
  onNextQuestion,
}: QuizReviewScreenProps) {
  const isAnswered = submissionResult !== null;
  const canSubmit =
    question.questionType === 'multiple_choice'
      ? Boolean(selectedChoiceId)
      : freeTextInput.trim().length > 0;

  const isModelUnavailable = modelStatus.state === 'missing';
  const isModelBusyLoading =
    modelStatus.state === 'loading' || modelStatus.state === 'verifying';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* 1. Top Meta Row: Progress + 5% CSC Red Accent Difficulty/Page Badge */}
      <View style={styles.metaRow}>
        <Text style={styles.progressLabel}>
          Question {questionNumber} of {totalQuestions}
        </Text>
        <View style={styles.badgeGroup}>
          {question.difficulty && (
            <View style={styles.redAccentBadge}>
              <Text style={styles.redAccentBadgeText}>
                {question.difficulty.toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.neutralBadge}>
            <Text style={styles.neutralBadgeText}>p. {question.sourcePage}</Text>
          </View>
        </View>
      </View>

      {/* 2. Question Stem Card (16pt radius, 1pt subtle border) */}
      <ContentCard style={styles.stemCard}>
        <Text style={styles.stemText}>{question.stem}</Text>

        {/* Multiple-Choice Options */}
        {question.questionType === 'multiple_choice' ? (
          <View style={styles.choicesList}>
            {question.choices.map((choice: Choice) => {
              const isSelected = selectedChoiceId === choice.id;
              const isCanonical =
                isAnswered && submissionResult?.canonicalChoiceId === choice.id;
              const isWrongSelection =
                isAnswered && isSelected && !submissionResult?.isCorrect;

              return (
                <Pressable
                  key={choice.id}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: isSelected,
                    disabled: isAnswered,
                  }}
                  disabled={isAnswered}
                  onPress={() => onSelectChoice(choice.id)}
                  style={[
                    styles.choiceRow,
                    isSelected && styles.choiceRowSelected,
                    isCanonical && styles.choiceRowCorrect,
                    isWrongSelection && styles.choiceRowIncorrect,
                  ]}
                >
                  <View
                    style={[
                      styles.choiceKeyBadge,
                      isSelected && styles.choiceKeyBadgeSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceKeyText,
                        isSelected && styles.choiceKeyTextSelected,
                      ]}
                    >
                      {choice.choiceKey}
                    </Text>
                  </View>
                  <Text style={styles.choiceText}>{choice.text}</Text>
                </Pressable>
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
              placeholder="Type your answer here..."
              placeholderTextColor={colors.neutral.textMuted}
              style={styles.textInput}
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
              title="Next Question"
              variant="primary"
              onPress={onNextQuestion}
            />
          )}
        </View>
      </ContentCard>

      {/* 3. Post-Submission Deterministic Feedback & Grounded AI Explanation */}
      {isAnswered && submissionResult && (
        <ContentCard delayMs={60} style={styles.explanationCard}>
          {/* Deterministic Score Banner */}
          <View
            style={[
              styles.verdictBanner,
              submissionResult.isCorrect
                ? styles.verdictCorrect
                : styles.verdictIncorrect,
            ]}
          >
            <Text
              style={[
                styles.verdictTitle,
                {
                  color: submissionResult.isCorrect
                    ? colors.semantic.correct.text
                    : colors.semantic.incorrect.text,
                },
              ]}
            >
              {submissionResult.isCorrect
                ? '✓ Correct Answer'
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

          {/* On-Device AI Elaboration Output */}
          {aiExplanation && (
            <View style={styles.aiBox}>
              <Text style={styles.aiHeading}>AI Tutor Explanation</Text>
              <Text style={styles.bodyText}>{aiExplanation.explanation}</Text>
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
  redAccentBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    borderColor: colors.accent.primary,
    backgroundColor: colors.neutral.surfaceElevated,
  },
  redAccentBadgeText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.accent.primary,
  },
  neutralBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surfaceElevated,
  },
  neutralBadgeText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '500',
    color: colors.neutral.textSecondary,
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
  choiceRow: {
    minHeight: controls.minimumTouchTarget,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  choiceRowSelected: {
    borderWidth: borders.emphasized,
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.tint,
  },
  choiceRowCorrect: {
    borderWidth: borders.focused,
    borderColor: colors.semantic.correct.border,
    backgroundColor: colors.semantic.correct.surface,
  },
  choiceRowIncorrect: {
    borderWidth: borders.emphasized,
    borderColor: colors.semantic.incorrect.border,
    backgroundColor: colors.semantic.incorrect.surface,
  },
  choiceKeyBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral.surface,
  },
  choiceKeyBadgeSelected: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  choiceKeyText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  choiceKeyTextSelected: {
    color: colors.brand.contrastText,
  },
  choiceText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.neutral.textPrimary,
    lineHeight: typography.body.lineHeight,
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
});

