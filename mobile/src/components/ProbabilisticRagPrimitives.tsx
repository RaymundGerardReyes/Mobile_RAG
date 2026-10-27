import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import {
  borders,
  colors,
  controls,
  elevation,
  motion,
  radius,
  spacing,
  typography,
} from '../theme/tokens.js';
import { Choice } from '../domain/types.js';
import { ConsensusEvaluationBreakdown } from '../application/use_cases/interpret_free_answer.js';
import { FreeAnswerVerdictType } from '../ai/evaluation/output_validator.js';
import {
  RetrievalTier,
  RetrievalTierConfig,
  RETRIEVAL_TIER_CONFIG,
} from '../application/ports/passage_retriever.js';

export {
  RetrievalTier,
  RetrievalTierConfig,
  RETRIEVAL_TIER_CONFIG,
};

// ============================================================================
// 2. <RetrievalTierBadge> Component
// ============================================================================

export interface RetrievalTierBadgeProps {
  tier: RetrievalTier;
  showDot?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const RetrievalTierBadge: React.FC<RetrievalTierBadgeProps> = ({
  tier,
  showDot = true,
  compact = false,
  style,
}) => {
  const config = RETRIEVAL_TIER_CONFIG[tier] ?? RETRIEVAL_TIER_CONFIG.fts5;

  return (
    <View
      style={[
        styles.tierBadge,
        {
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
        },
        compact && styles.tierBadgeCompact,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${config.label}. ${config.description}.`}
    >
      {showDot && (
        <View
          style={[styles.indicatorDot, { backgroundColor: config.dotColor }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}
      <Text
        style={[
          styles.tierBadgeText,
          { color: config.textColor },
          compact && styles.tierBadgeTextCompact,
        ]}
      >
        {compact ? config.shortLabel : config.label}
      </Text>
    </View>
  );
};

// ============================================================================
// 3. <BestOfNConsensusCard> Component
// ============================================================================

export interface BestOfNConsensusCardProps {
  breakdown?: ConsensusEvaluationBreakdown;
  consensus?: ConsensusEvaluationBreakdown;
  style?: StyleProp<ViewStyle>;
}

export const BestOfNConsensusCard: React.FC<BestOfNConsensusCardProps> = ({
  breakdown: propBreakdown,
  consensus: propConsensus,
  style,
}) => {
  const breakdown = propBreakdown ?? propConsensus;
  if (!breakdown) return null;

  const total = Math.max(breakdown.numSamples, 1);
  const eqRatio = (breakdown.verdictDistribution.equivalent ?? 0) / total;
  const partRatio = (breakdown.verdictDistribution.partially_equivalent ?? 0) / total;
  const ambigRatio = (breakdown.verdictDistribution.ambiguous ?? 0) / total;
  const incRatio = (breakdown.verdictDistribution.incorrect ?? 0) / total;

  const confidencePct = Math.round(breakdown.averageConfidence * 100);
  const isConfidencePass = breakdown.averageConfidence >= 0.75;

  // Winning verdict styling
  const winningConfig: Record<
    FreeAnswerVerdictType,
    { label: string; text: string; bg: string; border: string }
  > = {
    equivalent: {
      label: 'Consensus: Full Credit (1.0)',
      text: colors.semantic.correct.text,
      bg: colors.semantic.correct.surface,
      border: colors.semantic.correct.border,
    },
    partially_equivalent: {
      label: 'Consensus: Partial Credit (0.5)',
      text: colors.semantic.warning.text,
      bg: colors.semantic.warning.surface,
      border: colors.semantic.warning.border,
    },
    ambiguous: {
      label: 'Consensus: Ambiguous (0.0)',
      text: colors.semantic.incorrect.text,
      bg: colors.semantic.incorrect.surface,
      border: colors.semantic.incorrect.border,
    },
    incorrect: {
      label: 'Consensus: Incorrect (0.0)',
      text: colors.neutral.textPrimary,
      bg: colors.neutral.surfaceMuted,
      border: colors.neutral.borderStrong,
    },
  };

  const winningStyle =
    winningConfig[breakdown.winningVerdict] ?? winningConfig.ambiguous;

  const g1Pass = breakdown.guardrailSummary.malformedJsonCount === 0;
  const g2Pass = breakdown.guardrailSummary.hallucinatedEvidenceCount === 0;
  const g3Pass = breakdown.guardrailSummary.lowConfidenceCount === 0 && isConfidencePass;
  const g4Pass = breakdown.guardrailSummary.allPassed;

  const winningEval = breakdown.winningEvaluation;

  return (
    <View style={[styles.consensusCard, style]}>
      {/* Header Row */}
      <View style={styles.cardHeader}>
        <View style={styles.headerTitles}>
          <Text style={styles.overlineText}>PROBABILISTIC SELF-CONSISTENCY</Text>
          <Text style={styles.cardTitle}>
            Best-of-N Consensus (N = {breakdown.numSamples})
          </Text>
        </View>
        <View
          style={[
            styles.winningBadge,
            {
              backgroundColor: winningStyle.bg,
              borderColor: winningStyle.border,
            },
          ]}
        >
          <Text style={[styles.winningBadgeText, { color: winningStyle.text }]}>
            {winningStyle.label}
          </Text>
        </View>
      </View>

      {/* Voting Distribution Proportional Bar */}
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Voting Distribution:</Text>
          <Text style={styles.agreementText}>
            {Math.round(breakdown.agreementRate * 100)}% Agreement
          </Text>
        </View>

        <View style={styles.barContainer}>
          {eqRatio > 0 && (
            <View
              style={[
                styles.barSegment,
                {
                  flex: eqRatio,
                  backgroundColor: colors.semantic.correct.text,
                  borderTopLeftRadius: 4,
                  borderBottomLeftRadius: 4,
                },
              ]}
            />
          )}
          {partRatio > 0 && (
            <View
              style={[
                styles.barSegment,
                {
                  flex: partRatio,
                  backgroundColor: colors.semantic.warning.text,
                },
              ]}
            />
          )}
          {ambigRatio > 0 && (
            <View
              style={[
                styles.barSegment,
                {
                  flex: ambigRatio,
                  backgroundColor: colors.semantic.incorrect.text,
                },
              ]}
            />
          )}
          {incRatio > 0 && (
            <View
              style={[
                styles.barSegment,
                {
                  flex: incRatio,
                  backgroundColor: colors.neutral.textSecondary,
                  borderTopRightRadius: 4,
                  borderBottomRightRadius: 4,
                },
              ]}
            />
          )}
        </View>

        {/* Legend / Tally */}
        <Text style={styles.tallyText}>
          {breakdown.verdictDistribution.equivalent > 0 &&
            `${breakdown.verdictDistribution.equivalent}/${total} Equivalent `}
          {breakdown.verdictDistribution.partially_equivalent > 0 &&
            `· ${breakdown.verdictDistribution.partially_equivalent}/${total} Partial `}
          {breakdown.verdictDistribution.incorrect > 0 &&
            `· ${breakdown.verdictDistribution.incorrect}/${total} Incorrect `}
          {breakdown.verdictDistribution.ambiguous > 0 &&
            `· ${breakdown.verdictDistribution.ambiguous}/${total} Ambiguous`}
        </Text>
      </View>

      {/* Average Confidence Meter */}
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Average Model Confidence:</Text>
          <Text
            style={[
              styles.confidenceValueText,
              {
                color: isConfidencePass
                  ? colors.brand.primary
                  : colors.semantic.warning.text,
              },
            ]}
          >
            {confidencePct}%
          </Text>
        </View>

        <View style={styles.meterTrack}>
          <View
            style={[
              styles.meterFill,
              {
                width: `${Math.min(Math.max(confidencePct, 0), 100)}%`,
                backgroundColor: isConfidencePass
                  ? colors.brand.primary
                  : colors.semantic.warning.text,
              },
            ]}
          />
        </View>
        <Text style={styles.footnoteText}>
          (Minimum 75% confidence threshold required for automatic grading)
        </Text>
      </View>

      {/* 4-Tier Guardrail Verification Matrix */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>4-Tier Guardrail Verification Status:</Text>
        <View style={styles.guardrailGrid}>
          <View style={styles.guardrailItem}>
            <Text
              style={[
                styles.guardrailIcon,
                {
                  color: g1Pass
                    ? colors.semantic.correct.text
                    : colors.semantic.incorrect.text,
                },
              ]}
            >
              {g1Pass ? '✓' : '✕'}
            </Text>
            <Text style={styles.guardrailLabel}>
              G1: JSON Schema Conformance ({g1Pass ? 'Pass' : 'Malformed'})
            </Text>
          </View>

          <View style={styles.guardrailItem}>
            <Text
              style={[
                styles.guardrailIcon,
                {
                  color: g2Pass
                    ? colors.semantic.correct.text
                    : colors.semantic.incorrect.text,
                },
              ]}
            >
              {g2Pass ? '✓' : '✕'}
            </Text>
            <Text style={styles.guardrailLabel}>
              G2: Provenance Grounding ({g2Pass ? 'Pass' : 'Hallucinated'})
            </Text>
          </View>

          <View style={styles.guardrailItem}>
            <Text
              style={[
                styles.guardrailIcon,
                {
                  color: g3Pass
                    ? colors.semantic.correct.text
                    : colors.semantic.warning.text,
                },
              ]}
            >
              {g3Pass ? '✓' : '✕'}
            </Text>
            <Text style={styles.guardrailLabel}>
              G3: Confidence Threshold ({confidencePct}% {isConfidencePass ? '≥' : '<'} 75%)
            </Text>
          </View>

          <View style={styles.guardrailItem}>
            <Text
              style={[
                styles.guardrailIcon,
                {
                  color: g4Pass
                    ? colors.semantic.correct.text
                    : colors.semantic.warning.text,
                },
              ]}
            >
              {g4Pass ? '✓' : '✕'}
            </Text>
            <Text style={styles.guardrailLabel}>
              G4: Deterministic Scoring Consistency ({g4Pass ? 'Pass' : 'Review'})
            </Text>
          </View>
        </View>
      </View>

      {/* Matched & Missing Concepts */}
      {winningEval && (
        <View style={styles.conceptsContainer}>
          {winningEval.matchedConcepts.length > 0 && (
            <View style={styles.conceptRowWrapper}>
              <Text style={styles.conceptLabel}>Matched Concepts:</Text>
              <View style={styles.conceptChipsRow}>
                {winningEval.matchedConcepts.map((concept, idx) => (
                  <View key={`matched-${idx}`} style={styles.matchedChip}>
                    <Text style={styles.matchedChipText}>{concept} ✓</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {winningEval.missingConcepts.length > 0 && (
            <View style={styles.conceptRowWrapper}>
              <Text style={styles.conceptLabel}>Missing Concepts:</Text>
              <View style={styles.conceptChipsRow}>
                {winningEval.missingConcepts.map((concept, idx) => (
                  <View key={`missing-${idx}`} style={styles.missingChip}>
                    <Text style={styles.missingChipText}>{concept}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Manual Review Alert */}
      {(winningEval?.requiresManualReview ||
        breakdown.agreementRate < 0.67 ||
        !breakdown.guardrailSummary.allPassed) && (
        <View style={styles.manualReviewBanner}>
          <Text style={styles.manualReviewBannerText}>
            ⚠️ Manual Review Recommended by Examiner
          </Text>
        </View>
      )}
    </View>
  );
};

// ============================================================================
// 4. <FollowUpClarificationBar> Component
// ============================================================================

export interface FollowUpClarificationBarProps {
  choices?: Choice[];
  canonicalChoiceId?: string | null;
  selectedChoiceId?: string | null;
  isLoading?: boolean;
  onAskDistractor: (choice: Choice) => void;
  onCustomQuerySubmit: (query: string) => void;
  style?: StyleProp<ViewStyle>;
}

export const FollowUpClarificationBar: React.FC<FollowUpClarificationBarProps> = ({
  choices = [],
  canonicalChoiceId,
  selectedChoiceId,
  isLoading = false,
  onAskDistractor,
  onCustomQuerySubmit,
  style,
}) => {
  const [customQuery, setCustomQuery] = useState('');

  const distractorChoices = choices.filter((c) => c.id !== canonicalChoiceId);

  const handleSubmit = () => {
    const trimmed = customQuery.trim();
    if (trimmed && !isLoading) {
      onCustomQuerySubmit(trimmed);
      setCustomQuery('');
    }
  };

  return (
    <View style={[styles.clarificationContainer, style]}>
      <Text style={styles.clarificationHeader}>QUICK FOLLOW-UP CLARIFICATIONS</Text>

      {/* Distractor Quick-Ask Chips */}
      {distractorChoices.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScrollContent}
        >
          {distractorChoices.map((choice) => {
            const isUserPick = choice.id === selectedChoiceId;
            return (
              <Pressable
                key={choice.id}
                style={({ pressed }) => [
                  styles.distractorChip,
                  isUserPick && styles.distractorChipSelected,
                  pressed && styles.distractorChipPressed,
                  isLoading && styles.distractorChipDisabled,
                ]}
                disabled={isLoading}
                onPress={() => onAskDistractor(choice)}
                accessibilityRole="button"
                accessibilityLabel={`Why is Choice ${choice.choiceKey} wrong? ${
                  isUserPick ? 'Your selected choice.' : ''
                }`}
                accessibilityHint="Requests distractor-aware textbook evidence and clarification"
              >
                {isUserPick && <View style={styles.userPickDot} />}
                <Text
                  style={[
                    styles.distractorChipText,
                    isUserPick && styles.distractorChipTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  Why is Choice {choice.choiceKey} wrong?
                  {isUserPick ? ' (Your Pick)' : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Custom Query Input Box (Apple HIG minTouchTarget >= 44pt) */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={customQuery}
          onChangeText={setCustomQuery}
          placeholder="Ask a custom follow-up question..."
          placeholderTextColor={colors.neutral.textMuted}
          editable={!isLoading}
          returnKeyType="send"
          onSubmitEditing={handleSubmit}
          accessibilityLabel="Custom follow-up question"
          accessibilityHint="Type a specific question for on-device AI clarification"
        />
        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            (!customQuery.trim() || isLoading) && styles.submitButtonDisabled,
            pressed && styles.submitButtonPressed,
          ]}
          disabled={!customQuery.trim() || isLoading}
          onPress={handleSubmit}
          accessibilityRole="button"
          accessibilityLabel="Ask follow-up"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.neutral.canvas} />
          ) : (
            <Text style={styles.submitButtonText}>Ask</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Retrieval Tier Badge
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    minHeight: 24,
    alignSelf: 'flex-start',
  },
  tierBadgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    minHeight: 20,
  },
  indicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  tierBadgeText: {
    fontSize: typography.caption.fontSize,
    lineHeight: 14,
    fontWeight: '600',
  },
  tierBadgeTextCompact: {
    fontSize: 10,
    lineHeight: 12,
  },

  // Consensus Card
  consensusCard: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.card,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.lg,
    marginVertical: spacing.sm,
    ...elevation.subtle,
  },
  cardHeader: {
    marginBottom: spacing.md,
  },
  headerTitles: {
    marginBottom: spacing.xs,
  },
  overlineText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: typography.headline.fontWeight as any,
    color: colors.neutral.textPrimary,
  },
  winningBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  winningBadgeText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
  },

  // Section Blocks
  sectionBlock: {
    marginTop: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  agreementText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  confidenceValueText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '700',
  },

  // Voting Bar
  barContainer: {
    flexDirection: 'row',
    height: 8,
    backgroundColor: colors.neutral.surfaceMuted,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  barSegment: {
    height: '100%',
  },
  tallyText: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: 2,
  },

  // Confidence Meter
  meterTrack: {
    height: 6,
    backgroundColor: colors.neutral.borderSubtle,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  meterFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  footnoteText: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textMuted,
    marginTop: 2,
  },

  // 4-Tier Guardrail Grid
  guardrailGrid: {
    marginTop: spacing.xs,
    backgroundColor: colors.neutral.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
  },
  guardrailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  guardrailIcon: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 6,
    width: 16,
  },
  guardrailLabel: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textPrimary,
    fontWeight: '500',
  },

  // Concept Chips
  conceptsContainer: {
    marginTop: spacing.md,
  },
  conceptRowWrapper: {
    marginTop: spacing.xs,
  },
  conceptLabel: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
    marginBottom: 4,
  },
  conceptChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  matchedChip: {
    backgroundColor: colors.semantic.correct.surface,
    borderColor: colors.semantic.correct.border,
    borderWidth: borders.hairline,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  matchedChipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.semantic.correct.text,
  },
  missingChip: {
    backgroundColor: colors.semantic.warning.surface,
    borderColor: colors.semantic.warning.border,
    borderWidth: borders.hairline,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  missingChipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.semantic.warning.text,
  },

  // Manual Review Banner
  manualReviewBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.semantic.warning.surface,
    borderColor: colors.semantic.warning.border,
    borderWidth: borders.hairline,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  manualReviewBannerText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.semantic.warning.text,
  },

  // Clarification Bar
  clarificationContainer: {
    marginTop: spacing.md,
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.card,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.base,
    ...elevation.subtle,
  },
  clarificationHeader: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  chipsScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  distractorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: controls.minTouchTarget, // Apple HIG >= 44pt
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.neutral.surface,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
  },
  distractorChipSelected: {
    backgroundColor: colors.semantic.incorrect.surface,
    borderColor: colors.semantic.incorrect.border,
  },
  distractorChipPressed: {
    opacity: motion.opacity.pressed,
    transform: [{ scale: motion.scale.pressed }],
  },
  distractorChipDisabled: {
    opacity: 0.5,
  },
  userPickDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.semantic.incorrect.text,
    marginRight: 6,
  },
  distractorChipText: {
    fontSize: typography.subheadline.fontSize,
    color: colors.neutral.textPrimary,
    fontWeight: '500',
  },
  distractorChipTextSelected: {
    color: colors.semantic.incorrect.text,
    fontWeight: '600',
  },

  // Input Row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  textInput: {
    flex: 1,
    minHeight: controls.minTouchTarget, // Apple HIG >= 44pt
    backgroundColor: colors.neutral.surface,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
    paddingHorizontal: spacing.base,
    fontSize: typography.body.fontSize,
    color: colors.neutral.textPrimary,
  },
  submitButton: {
    minHeight: controls.minTouchTarget, // Apple HIG >= 44pt
    minWidth: 54,
    backgroundColor: colors.brand.primary,
    borderRadius: radius.control,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
  },
  submitButtonDisabled: {
    backgroundColor: colors.neutral.borderDefault,
  },
  submitButtonPressed: {
    backgroundColor: colors.brand.dark,
    opacity: motion.opacity.pressed,
  },
  submitButtonText: {
    color: colors.neutral.canvas,
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
  },
});
