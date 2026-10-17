import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import {
  borders,
  colors,
  controls,
  motion,
  radius,
  spacing,
  typography,
} from '../theme/tokens.js';

// ============================================================================
// 1. LAYOUT PRIMITIVES (ScreenContainer, ScreenHeader, SectionHeader, BottomActionBar)
// ============================================================================

export interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Safe-area-aware foundation for every screen on iPhone 16.
 * Enforces 20pt horizontal editorial padding and predictable scroll insets.
 */
export function ScreenContainer({
  children,
  scrollable = true,
  footer,
  header,
  style,
  contentContainerStyle,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={[styles.safeArea, style]}>
      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header}
        {scrollable ? (
          <ScrollView
            style={styles.flexOne}
            contentContainerStyle={[
              styles.scrollContent,
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.staticContent, contentContainerStyle]}>
            {children}
          </View>
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  rightElement?: React.ReactNode;
}

/**
 * Compact, native-feeling iOS navigation header.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Home',
  rightElement,
}: ScreenHeaderProps) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.screenHeaderLeft}>
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            hitSlop={12}
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: motion.opacity.pressed },
            ]}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backLabelText}>{backLabel}</Text>
          </Pressable>
        )}
        <View style={styles.headerTitleContainer}>
          {subtitle ? (
            <Text style={styles.screenHeaderOverline} numberOfLines={1}>
              {subtitle.toUpperCase()}
            </Text>
          ) : null}
          <Text style={styles.screenHeaderTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
      {rightElement ? (
        <View style={styles.screenHeaderRight}>{rightElement}</View>
      ) : null}
    </View>
  );
}

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  rightText?: string;
}

/**
 * Editorial section header with optional secondary metadata or action.
 */
export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
  rightText,
}: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onActionPress}
        >
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
        </Pressable>
      ) : rightText ? (
        <Text style={styles.sectionRightMeta}>{rightText}</Text>
      ) : null}
    </View>
  );
}

export interface BottomActionBarProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Persistent bottom action bar respecting thumb reach and iPhone safe areas.
 */
export function BottomActionBar({ children, style }: BottomActionBarProps) {
  return <View style={[styles.bottomActionBar, style]}>{children}</View>;
}

// ============================================================================
// 2. CORE INTERACTIVE PRIMITIVES (CSCButton, CSCChipBadge, ContentCard, AnimatedProgressBar)
// ============================================================================

export type CSCButtonVariant = 'primary' | 'secondary' | 'subtle';

export interface CSCButtonProps {
  title: string;
  onPress: () => void;
  variant?: CSCButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Accessible iOS button with >= 50pt height and deterministic pressed/disabled states.
 */
export function CSCButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
}: CSCButtonProps) {
  const isInteractive = !disabled && !loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      disabled={!isInteractive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'subtle' && styles.buttonSubtle,
        !isInteractive && styles.buttonDisabled,
        pressed && isInteractive && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'primary'
              ? colors.brand.contrastText
              : colors.brand.primary
          }
        />
      ) : (
        <Text
          style={[
            styles.buttonTextBase,
            variant === 'primary' && styles.buttonTextPrimary,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'subtle' && styles.buttonTextSubtle,
            !isInteractive && styles.buttonTextDisabled,
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export type CSCChipVariant =
  | 'brand'
  | 'accentRed'
  | 'success'
  | 'warning'
  | 'neutral';

export interface CSCChipBadgeProps {
  label: string;
  variant?: CSCChipVariant;
  indicatorDot?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * High-contrast status and metadata badge adhering to WCAG AA rules.
 * Pairs accentRed with dark primary text (#191D2E) and a red indicator dot.
 */
export function CSCChipBadge({
  label,
  variant = 'neutral',
  indicatorDot = false,
  style,
}: CSCChipBadgeProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'brand':
        return {
          container: {
            backgroundColor: colors.brand.tint,
            borderColor: colors.brand.border,
          },
          text: { color: colors.brand.primary },
          dot: colors.brand.primary,
        };
      case 'accentRed':
        return {
          container: {
            backgroundColor: colors.accent.tint,
            borderColor: colors.accent.light,
          },
          // Strictly pair accentRed surface with dark textPrimary for WCAG AAA compliance
          text: { color: colors.neutral.textPrimary },
          dot: colors.accent.primary,
        };
      case 'success':
        return {
          container: {
            backgroundColor: colors.semantic.correct.surface,
            borderColor: colors.semantic.correct.border,
          },
          text: { color: colors.semantic.correct.text },
          dot: colors.semantic.correct.text,
        };
      case 'warning':
        return {
          container: {
            backgroundColor: colors.semantic.warning.surface,
            borderColor: colors.semantic.warning.border,
          },
          text: { color: colors.semantic.warning.text },
          dot: colors.semantic.warning.text,
        };
      case 'neutral':
      default:
        return {
          container: {
            backgroundColor: colors.neutral.surfaceMuted,
            borderColor: colors.neutral.borderSubtle,
          },
          text: { color: colors.neutral.textSecondary },
          dot: colors.neutral.textSecondary,
        };
    }
  };

  const vStyles = getVariantStyles();

  return (
    <View style={[styles.chipBase, vStyles.container, style]}>
      {indicatorDot && (
        <View style={[styles.chipDot, { backgroundColor: vStyles.dot }]} />
      )}
      <Text style={[styles.chipText, vStyles.text]}>{label}</Text>
    </View>
  );
}

export interface ContentCardProps {
  children: React.ReactNode;
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Restrained surface container with 1pt subtle border and no heavy shadows.
 */
export function ContentCard({ children, style }: ContentCardProps) {
  return <View style={[styles.contentCard, style]}>{children}</View>;
}

export interface AnimatedProgressBarProps {
  current: number;
  total: number;
  height?: number;
  color?: string;
}

/**
 * Smooth horizontal progress bar communicating completion clearly.
 */
export function AnimatedProgressBar({
  current,
  total,
  height = 6,
  color = colors.brand.primary,
}: AnimatedProgressBarProps) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(current / safeTotal, 0), 1);
  const animatedWidth = useRef(new Animated.Value(ratio)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: ratio,
      duration: motion.duration.normal,
      useNativeDriver: false,
    }).start();
  }, [ratio, animatedWidth]);

  const widthInterpolated = animatedWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: safeTotal, now: current }}
      style={[styles.progressTrack, { height }]}
    >
      <Animated.View
        style={[
          styles.progressFill,
          {
            height,
            backgroundColor: color,
            width: widthInterpolated,
          },
        ]}
      />
    </View>
  );
}

// ============================================================================
// 3. LEARNING PRIMITIVES (AnimatedChoiceRow, SubjectRow, Flashcard, Feedback, Summary)
// ============================================================================

export interface AnimatedChoiceRowProps {
  choiceKey: string;
  text: string;
  selected: boolean;
  disabled?: boolean;
  isCorrect?: boolean;
  isIncorrect?: boolean;
  index?: number;
  onPress: () => void;
}

/**
 * Large, thumb-friendly multiple-choice option row (minHeight: 58pt).
 * Communicates selected, correct, and incorrect states using color, border weight, and text badges.
 */
export function AnimatedChoiceRow({
  choiceKey,
  text,
  selected,
  disabled = false,
  isCorrect = false,
  isIncorrect = false,
  onPress,
}: AnimatedChoiceRowProps) {
  const getRowStyle = (): ViewStyle => {
    if (isCorrect) {
      return {
        backgroundColor: colors.semantic.correct.surface,
        borderColor: colors.semantic.correct.border,
        borderWidth: borders.emphasized,
      };
    }
    if (isIncorrect) {
      return {
        backgroundColor: colors.semantic.incorrect.surface,
        borderColor: colors.semantic.incorrect.border,
        borderWidth: borders.emphasized,
      };
    }
    if (selected) {
      return {
        backgroundColor: colors.brand.tint,
        borderColor: colors.brand.primary,
        borderWidth: borders.focused,
      };
    }
    return {
      backgroundColor: colors.neutral.surfaceElevated,
      borderColor: colors.neutral.borderDefault,
      borderWidth: borders.hairline,
    };
  };

  const getBadgeStyle = (): ViewStyle => {
    if (isCorrect) {
      return {
        backgroundColor: colors.semantic.correct.text,
        borderColor: colors.semantic.correct.text,
      };
    }
    if (isIncorrect) {
      return {
        backgroundColor: colors.semantic.incorrect.text,
        borderColor: colors.semantic.incorrect.text,
      };
    }
    if (selected) {
      return {
        backgroundColor: colors.brand.primary,
        borderColor: colors.brand.primary,
      };
    }
    return {
      backgroundColor: colors.neutral.surfaceMuted,
      borderColor: colors.neutral.borderDefault,
    };
  };

  const getKeyTextColor = (): string => {
    if (isCorrect || isIncorrect || selected) {
      return colors.brand.contrastText;
    }
    return colors.neutral.textPrimary;
  };

  const getStateLabel = (): string | null => {
    if (isCorrect) return '✓ Correct';
    if (isIncorrect) return '✕ Your Choice';
    return null;
  };

  const stateLabel = getStateLabel();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        selected,
        disabled,
      }}
      accessibilityLabel={`Option ${choiceKey}: ${text}${
        stateLabel ? `, ${stateLabel}` : ''
      }`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceRowBase,
        getRowStyle(),
        pressed && !disabled && styles.choiceRowPressed,
      ]}
    >
      <View style={[styles.choiceKeyBadge, getBadgeStyle()]}>
        <Text style={[styles.choiceKeyText, { color: getKeyTextColor() }]}>
          {choiceKey}
        </Text>
      </View>

      <View style={styles.choiceTextWrapper}>
        <Text
          style={[
            styles.choiceText,
            (selected || isCorrect) && styles.choiceTextEmphasized,
          ]}
        >
          {text}
        </Text>
        {stateLabel && (
          <Text
            style={[
              styles.choiceStatusCaption,
              {
                color: isCorrect
                  ? colors.semantic.correct.text
                  : colors.semantic.incorrect.text,
              },
            ]}
          >
            {stateLabel}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export interface SubjectRowProps {
  title: string;
  answeredCount: number;
  totalQuestions: number;
  accuracyPercent: number | null;
  onPress: () => void;
  isLast?: boolean;
}

/**
 * Compact, accessible iOS list row for subjects/topics on the Home & Library screens.
 * Replaces repetitive nested cards with clean horizontal dividers and a trailing chevron.
 */
export function SubjectRow({
  title,
  answeredCount,
  totalQuestions,
  accuracyPercent,
  onPress,
  isLast = false,
}: SubjectRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${answeredCount} of ${totalQuestions} answered${
        accuracyPercent !== null ? `, ${accuracyPercent}% accuracy` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.subjectRow,
        !isLast && styles.subjectRowDivider,
        pressed && styles.subjectRowPressed,
      ]}
    >
      <View style={styles.subjectRowMain}>
        <View style={styles.subjectRowTitleLine}>
          <Text style={styles.subjectRowTitle}>{title}</Text>
          {accuracyPercent !== null && (
            <CSCChipBadge
              label={`${accuracyPercent}%`}
              variant={accuracyPercent >= 75 ? 'success' : 'warning'}
            />
          )}
        </View>
        <Text style={styles.subjectRowMeta}>
          {answeredCount} of {totalQuestions} questions reviewed
        </Text>
        <View style={styles.subjectRowProgress}>
          <AnimatedProgressBar
            current={answeredCount}
            total={totalQuestions || 1}
            height={4}
          />
        </View>
      </View>
      <Text style={styles.subjectRowChevron}>›</Text>
    </Pressable>
  );
}

export interface FlashcardProps {
  topicLabel?: string;
  frontPrompt: string;
  backAnswer: string;
  explanation?: string | null;
  sourcePage?: number;
  revealed: boolean;
  onReveal: () => void;
}

/**
 * Dedicated Flashcard component with controlled reveal state and clear typography.
 */
export function Flashcard({
  topicLabel = 'CONCEPT RECALL',
  frontPrompt,
  backAnswer,
  explanation,
  sourcePage,
  revealed,
  onReveal,
}: FlashcardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        revealed
          ? `Answer revealed: ${backAnswer}`
          : `Flashcard prompt: ${frontPrompt}. Tap to reveal answer.`
      }
      disabled={revealed}
      onPress={onReveal}
      style={({ pressed }) => [
        styles.flashcardSurface,
        pressed && !revealed && { opacity: motion.opacity.pressed },
      ]}
    >
      <View style={styles.flashcardMetaRow}>
        <Text style={styles.flashcardOverline}>{topicLabel.toUpperCase()}</Text>
        {sourcePage ? (
          <CSCChipBadge label={`p. ${sourcePage}`} variant="neutral" />
        ) : null}
      </View>

      <Text style={styles.flashcardPromptText}>{frontPrompt}</Text>

      {!revealed ? (
        <View style={styles.flashcardHintBox}>
          <Text style={styles.flashcardHintText}>Tap to reveal answer</Text>
        </View>
      ) : (
        <View style={styles.flashcardBackSection}>
          <View style={styles.divider} />
          <Text style={styles.flashcardAnswerLabel}>OFFICIAL ANSWER</Text>
          <Text style={styles.flashcardAnswerText}>{backAnswer}</Text>
          {explanation ? (
            <View style={styles.flashcardExplanationBox}>
              <Text style={styles.flashcardExplanationLabel}>
                Why this is correct
              </Text>
              <Text style={styles.flashcardExplanationText}>{explanation}</Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export interface AnswerFeedbackBannerProps {
  isCorrect: boolean;
  score: number;
  canonicalAnswer?: string | null;
}

/**
 * Semantic feedback banner combining color, border, icon symbol, and explicit text.
 */
export function AnswerFeedbackBanner({
  isCorrect,
  score,
  canonicalAnswer,
}: AnswerFeedbackBannerProps) {
  const isPartial = !isCorrect && score > 0;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.feedbackBanner,
        isCorrect
          ? styles.feedbackCorrect
          : isPartial
          ? styles.feedbackPartial
          : styles.feedbackIncorrect,
      ]}
    >
      <Text
        style={[
          styles.feedbackTitle,
          {
            color: isCorrect
              ? colors.semantic.correct.text
              : isPartial
              ? colors.semantic.warning.text
              : colors.semantic.incorrect.text,
          },
        ]}
      >
        {isCorrect
          ? '✓ Correct Answer'
          : isPartial
          ? `! Partially Correct (${Math.round(score * 100)}%)`
          : `✕ Incorrect — Official Answer: ${canonicalAnswer ?? 'See below'}`}
      </Text>
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.emptyStateBox}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateMessage}>{message}</Text>
      {actionLabel && onAction && (
        <CSCButton
          title={actionLabel}
          variant="secondary"
          onPress={onAction}
          style={styles.emptyStateButton}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
  },
  flexOne: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl, // 20pt iPhone 16 horizontal padding
    paddingTop: spacing.base,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  staticContent: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.neutral.canvas,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.neutral.borderSubtle,
    minHeight: 52,
  },
  screenHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: controls.minTouchTarget,
    paddingRight: spacing.xs,
  },
  backChevron: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.brand.primary,
    marginRight: 2,
    lineHeight: 26,
  },
  backLabelText: {
    fontSize: typography.callout.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  headerTitleContainer: {
    flex: 1,
  },
  screenHeaderOverline: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
    letterSpacing: 0.5,
  },
  screenHeaderTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  screenHeaderRight: {
    marginLeft: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  sectionHeaderText: {
    fontSize: typography.title2.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  sectionActionText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  sectionRightMeta: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  bottomActionBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.base,
    backgroundColor: colors.neutral.canvas,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.neutral.borderSubtle,
  },
  buttonBase: {
    minHeight: controls.buttonHeight, // 50pt
    borderRadius: radius.md, // 12pt consistent radius
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonPrimary: {
    backgroundColor: colors.brand.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderWidth: borders.hairline,
    borderColor: colors.brand.border,
  },
  buttonSubtle: {
    backgroundColor: colors.neutral.surfaceMuted,
  },
  buttonDisabled: {
    backgroundColor: colors.neutral.surfaceMuted,
    borderColor: colors.neutral.borderSubtle,
  },
  buttonPressed: {
    opacity: motion.opacity.pressed,
    transform: [{ scale: motion.scale.pressed }],
  },
  buttonTextBase: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: colors.brand.contrastText,
  },
  buttonTextSecondary: {
    color: colors.brand.primary,
  },
  buttonTextSubtle: {
    color: colors.neutral.textPrimary,
  },
  buttonTextDisabled: {
    color: colors.neutral.textMuted,
  },
  chipBase: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    gap: spacing.xs,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  contentCard: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.base,
  },
  progressTrack: {
    width: '100%',
    backgroundColor: colors.neutral.borderSubtle,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: radius.pill,
  },
  choiceRowBase: {
    minHeight: 58, // 56-64pt recommended iPhone 16 answer option height
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  choiceRowPressed: {
    opacity: motion.opacity.pressed,
    transform: [{ scale: motion.scale.pressed }],
  },
  choiceKeyBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceKeyText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '700',
  },
  choiceTextWrapper: {
    flex: 1,
    gap: 2,
  },
  choiceText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.neutral.textPrimary,
  },
  choiceTextEmphasized: {
    fontWeight: '600',
  },
  choiceStatusCaption: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    marginTop: 2,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.neutral.surfaceElevated,
    minHeight: 68,
    gap: spacing.md,
  },
  subjectRowDivider: {
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.neutral.divider,
  },
  subjectRowPressed: {
    backgroundColor: colors.neutral.surfaceMuted,
  },
  subjectRowMain: {
    flex: 1,
    gap: spacing.xs,
  },
  subjectRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  subjectRowTitle: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  subjectRowMeta: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
  },
  subjectRowProgress: {
    marginTop: 2,
  },
  subjectRowChevron: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.neutral.textMuted,
  },
  flashcardSurface: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.xxl,
    minHeight: 260,
    justifyContent: 'space-between',
    gap: spacing.xl,
  },
  flashcardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flashcardOverline: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
    letterSpacing: 0.6,
  },
  flashcardPromptText: {
    fontSize: typography.title2.fontSize,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  flashcardHintBox: {
    paddingTop: spacing.base,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.neutral.divider,
    alignItems: 'center',
  },
  flashcardHintText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  flashcardBackSection: {
    gap: spacing.sm,
  },
  flashcardAnswerLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.semantic.correct.text,
    letterSpacing: 0.5,
  },
  flashcardAnswerText: {
    fontSize: typography.headline.fontSize,
    lineHeight: typography.headline.lineHeight,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  flashcardExplanationBox: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.neutral.surface,
    gap: spacing.xs,
  },
  flashcardExplanationLabel: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
  },
  flashcardExplanationText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.neutral.textPrimary,
  },
  divider: {
    height: borders.hairline,
    backgroundColor: colors.neutral.divider,
    marginVertical: spacing.xs,
  },
  feedbackBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
  },
  feedbackCorrect: {
    backgroundColor: colors.semantic.correct.surface,
    borderColor: colors.semantic.correct.border,
  },
  feedbackPartial: {
    backgroundColor: colors.semantic.warning.surface,
    borderColor: colors.semantic.warning.border,
  },
  feedbackIncorrect: {
    backgroundColor: colors.semantic.incorrect.surface,
    borderColor: colors.semantic.incorrect.border,
  },
  feedbackTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  emptyStateBox: {
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    gap: spacing.sm,
  },
  emptyStateTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
    textAlign: 'center',
  },
  emptyStateMessage: {
    fontSize: typography.subheadline.fontSize,
    color: colors.neutral.textSecondary,
    textAlign: 'center',
  },
  emptyStateButton: {
    marginTop: spacing.sm,
  },
});

