// File: src/components/CorePrimitives.tsx

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
  elevation,
  glass,
  motion,
  radius,
  spacing,
  typography,
} from '../theme/tokens.js';
import { RetrievedPassage } from '../application/ports/passage_retriever.js';
import { TopicSummary } from '../application/ports/question_repository.js';

/**
 * Hook that checks iOS / OS Reduce Motion accessibility preference.
 * When enabled, animations step immediately without delay or spring physics.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (isMounted) setReduceMotion(Boolean(enabled));
      }
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export const useReduceMotion = useReducedMotion;

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
export const ScreenContainer: React.FC<ScreenContainerProps> = ({
  children,
  scrollable = true,
  footer,
  header,
  style,
  contentContainerStyle,
}) => {
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
            contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
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
};

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
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  backLabel = 'Home',
  rightElement,
}) => {
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
};

export interface LiquidGlassTopBarProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  rightElement?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Modern Curved Liquid Glass Navigation Header.
 * Selective translucent blur overlay with high-contrast typography and Apple HIG 44pt touch targets.
 */
export const LiquidGlassTopBar: React.FC<LiquidGlassTopBarProps> = ({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  rightElement,
  style,
}) => {
  return (
    <View style={[styles.liquidGlassTopBar, style]}>
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
};

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  rightText?: string;
}

/**
 * Editorial section header with optional secondary metadata or action.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  actionLabel,
  onActionPress,
  rightText,
}) => {
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
};

export interface BottomActionBarProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Persistent bottom action bar respecting thumb reach and iPhone safe areas.
 */
export const BottomActionBar: React.FC<BottomActionBarProps> = ({
  children,
  style,
}) => {
  return (
    <View style={[styles.bottomActionBar, style]}>
      <View style={styles.bottomActionInner}>{children}</View>
    </View>
  );
};

// ============================================================================
// 2. CSCButton
// ============================================================================
export type CSCButtonVariant = 'primary' | 'secondary' | 'subtle';

export interface CSCButtonProps {
  title: string;
  onPress: () => void;
  variant?: CSCButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const CSCButton: React.FC<CSCButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  textStyle,
}) => {
  const reduceMotion = useReducedMotion();
  const scaleAnim = useRef(new Animated.Value(motion.scale.standard)).current;
  const isInteractive = !disabled && !loading;

  const handlePressIn = () => {
    if (!isInteractive || reduceMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.pressed,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (!isInteractive || reduceMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.standard,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
      useNativeDriver: true,
    }).start();
  };

  const getContainerStyle = (pressed: boolean): StyleProp<ViewStyle> => {
    if (disabled) {
      return [styles.buttonBase, styles.buttonDisabled, style];
    }
    const pressedOpacity = pressed ? motion.opacity.pressed : motion.opacity.resting;
    if (variant === 'secondary') {
      return [
        styles.buttonBase,
        styles.buttonSecondary,
        { opacity: pressedOpacity },
        style,
      ];
    }
    if (variant === 'subtle') {
      return [
        styles.buttonBase,
        styles.buttonSubtle,
        { opacity: pressedOpacity },
        style,
      ];
    }
    return [
      styles.buttonBase,
      {
        backgroundColor: pressed ? colors.brand.dark : colors.brand.primary,
        opacity: pressedOpacity,
      },
      style,
    ];
  };

  const getTextStyle = () => {
    if (disabled) return [styles.buttonText, { color: colors.neutral.textSecondary }, textStyle];
    if (variant === 'secondary') return [styles.buttonText, { color: colors.brand.primary }, textStyle];
    if (variant === 'subtle') return [styles.buttonText, { color: colors.neutral.textPrimary }, textStyle];
    return [styles.buttonText, { color: colors.brand.contrastText }, textStyle];
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={isInteractive ? onPress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={!isInteractive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !isInteractive, busy: loading }}
        style={({ pressed }) => getContainerStyle(pressed)}
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
          <Text style={getTextStyle()} maxFontSizeMultiplier={1.35}>
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
};

// ============================================================================
// 3. AnimatedChoiceRow
// ============================================================================
export type ChoiceRowState = 'unselected' | 'selected' | 'correct' | 'incorrect';

export interface AnimatedChoiceRowProps {
  choiceKey: string;
  text: string;
  selected?: boolean;
  disabled?: boolean;
  verdictState?: 'correct' | 'incorrect' | null;
  isCorrect?: boolean;
  isIncorrect?: boolean;
  index?: number;
  onPress: () => void;
}

export const AnimatedChoiceRow: React.FC<AnimatedChoiceRowProps> = ({
  choiceKey,
  text,
  selected = false,
  disabled = false,
  verdictState = null,
  isCorrect = false,
  isIncorrect = false,
  onPress,
}) => {
  const reduceMotion = useReducedMotion();
  const scaleAnim = useRef(new Animated.Value(motion.scale.standard)).current;

  // Resolve effective verdict state
  const resolvedVerdict =
    verdictState != null
      ? verdictState
      : isCorrect
      ? 'correct'
      : isIncorrect
      ? 'incorrect'
      : null;

  const handlePressIn = () => {
    if (disabled || reduceMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.pressed,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || reduceMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.standard,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
      useNativeDriver: true,
    }).start();
  };

  let rowBg: string = colors.neutral.surfaceElevated;
  let rowBorder: string = colors.neutral.borderDefault;
  let rowBorderWidth: number = borders.hairline;
  let badgeBg: string = colors.neutral.surfaceMuted;
  let badgeBorder: string = colors.neutral.borderSubtle;
  let badgeText: string = colors.neutral.textPrimary;
  let statusLabel: string | null = null;
  let statusColor: string = colors.neutral.textSecondary;

  if (resolvedVerdict === 'correct') {
    rowBg = colors.semantic.correct.surface;
    rowBorder = colors.semantic.correct.border;
    rowBorderWidth = borders.emphasized;
    badgeBg = colors.semantic.correct.text;
    badgeBorder = colors.semantic.correct.text;
    badgeText = colors.brand.contrastText;
    statusLabel = '✓ Correct';
    statusColor = colors.semantic.correct.text;
  } else if (resolvedVerdict === 'incorrect') {
    rowBg = colors.semantic.incorrect.surface;
    rowBorder = colors.semantic.incorrect.border;
    rowBorderWidth = borders.emphasized;
    badgeBg = colors.semantic.incorrect.text;
    badgeBorder = colors.semantic.incorrect.text;
    badgeText = colors.brand.contrastText;
    statusLabel = '✕ Your Choice';
    statusColor = colors.semantic.incorrect.text;
  } else if (selected) {
    rowBg = colors.brand.tint;
    rowBorder = colors.brand.primary;
    rowBorderWidth = borders.focused;
    badgeBg = colors.brand.primary;
    badgeBorder = colors.brand.primary;
    badgeText = colors.brand.contrastText;
  }

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={!disabled ? onPress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{
          checked: selected,
          disabled,
        }}
        accessibilityLabel={`Option ${choiceKey}: ${text}${
          statusLabel ? `, ${statusLabel}` : ''
        }`}
        style={({ pressed }) => [
          styles.choiceRow,
          {
            backgroundColor: rowBg,
            borderColor: rowBorder,
            borderWidth: rowBorderWidth,
            opacity:
              disabled && !resolvedVerdict && !selected
                ? 0.65
                : pressed && !disabled
                ? motion.opacity.pressed
                : motion.opacity.resting,
          },
        ]}
      >
        <View
          style={[
            styles.choiceKeyBadge,
            { backgroundColor: badgeBg, borderColor: badgeBorder },
          ]}
        >
          <Text style={[styles.choiceKeyText, { color: badgeText }]}>
            {choiceKey}
          </Text>
        </View>

        <View style={styles.choiceTextWrapper}>
          <Text
            style={[
              styles.choiceText,
              (selected || resolvedVerdict !== null) && styles.choiceTextEmphasized,
            ]}
          >
            {text}
          </Text>
          {statusLabel ? (
            <Text style={[styles.choiceStatusCaption, { color: statusColor }]}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
};

// ============================================================================
// 4. CSCChipBadge
// ============================================================================
export type CSCChipVariant =
  | 'brand'
  | 'accentRed'
  | 'success'
  | 'warning'
  | 'neutral';

export interface CSCChipBadgeProps {
  label: string;
  variant?: CSCChipVariant;
  showDot?: boolean;
  indicatorDot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const CSCChipBadge: React.FC<CSCChipBadgeProps> = ({
  label,
  variant = 'neutral',
  showDot = false,
  indicatorDot = false,
  style,
}) => {
  const effectiveShowDot = showDot || indicatorDot;

  let bg: string = colors.neutral.surfaceMuted;
  let border: string = colors.neutral.borderSubtle;
  let textColor: string = colors.neutral.textSecondary;
  let dotColor: string = colors.neutral.textSecondary;

  if (variant === 'brand') {
    bg = colors.brand.tint;
    border = colors.brand.border;
    textColor = colors.brand.primary;
    dotColor = colors.brand.primary;
  } else if (variant === 'accentRed') {
    // WCAG AAA Invariant: Dark primary text on light red tint with accent red dot
    bg = colors.accent.tint;
    border = colors.accent.light;
    textColor = colors.neutral.textPrimary;
    dotColor = colors.accent.primary;
  } else if (variant === 'success') {
    bg = colors.semantic.correct.surface;
    border = colors.semantic.correct.border;
    textColor = colors.semantic.correct.text;
    dotColor = colors.semantic.correct.text;
  } else if (variant === 'warning') {
    bg = colors.semantic.warning.surface;
    border = colors.semantic.warning.border;
    textColor = colors.semantic.warning.text;
    dotColor = colors.semantic.warning.text;
  }

  return (
    <View
      style={[styles.chipBadge, { backgroundColor: bg, borderColor: border }, style]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {effectiveShowDot ? (
        <View style={[styles.chipDot, { backgroundColor: dotColor }]} />
      ) : null}
      <Text style={[styles.chipText, { color: textColor }]} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
};

// ============================================================================
// 5. AnimatedProgressBar
// ============================================================================
export interface AnimatedProgressBarProps {
  current: number;
  total: number;
  height?: number;
  fillColor?: string;
  color?: string;
}

export const AnimatedProgressBar: React.FC<AnimatedProgressBarProps> = ({
  current,
  total,
  height = 4,
  fillColor,
  color,
}) => {
  const effectiveFillColor = fillColor || color || colors.brand.primary;
  const reduceMotion = useReducedMotion();
  const safeTotal = Math.max(total, 1);
  const safeRatio = total > 0 ? Math.min(Math.max(current / safeTotal, 0), 1) : 0;
  const progressAnim = useRef(new Animated.Value(safeRatio)).current;

  useEffect(() => {
    if (reduceMotion) {
      progressAnim.setValue(safeRatio);
      return;
    }
    Animated.timing(progressAnim, {
      toValue: safeRatio,
      duration: motion.duration.normal,
      useNativeDriver: false,
    }).start();
  }, [safeRatio, reduceMotion, progressAnim]);

  const widthInterpolated = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={[styles.progressTrack, { height }]}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: total,
        now: current,
      }}
    >
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: widthInterpolated,
            height,
            backgroundColor: effectiveFillColor,
          },
        ]}
      />
    </View>
  );
};

// ============================================================================
// 6. Flashcard
// ============================================================================
export interface FlashcardProps {
  topicTitle?: string;
  topicLabel?: string;
  sourcePage?: number;
  questionStem?: string;
  frontPrompt?: string;
  canonicalAnswer?: string;
  backAnswer?: string;
  canonicalExplanation?: string | null;
  explanation?: string | null;
  revealed: boolean;
  onToggleReveal?: () => void;
  onReveal?: () => void;
}

export const Flashcard: React.FC<FlashcardProps> = ({
  topicTitle,
  topicLabel = 'CIVIL SERVICE REVIEW',
  sourcePage,
  questionStem,
  frontPrompt = '',
  canonicalAnswer,
  backAnswer = '',
  canonicalExplanation,
  explanation,
  revealed,
  onToggleReveal,
  onReveal,
}) => {
  const reduceMotion = useReducedMotion();
  const revealAnim = useRef(new Animated.Value(revealed ? 1 : 0)).current;

  const effectiveTitle = topicTitle || topicLabel;
  const effectiveStem = questionStem || frontPrompt;
  const effectiveAnswer = canonicalAnswer || backAnswer;
  const effectiveExplanation = canonicalExplanation !== undefined ? canonicalExplanation : explanation;
  const handleToggle = onToggleReveal || onReveal || (() => {});

  useEffect(() => {
    if (!revealed) {
      revealAnim.setValue(0);
      return;
    }
    if (reduceMotion) {
      revealAnim.setValue(1);
      return;
    }
    Animated.timing(revealAnim, {
      toValue: 1,
      duration: motion.duration.slow,
      useNativeDriver: true,
    }).start();
  }, [revealed, reduceMotion, revealAnim]);

  return (
    <Pressable
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel={
        revealed
          ? `Flashcard answer revealed: ${effectiveAnswer}`
          : `Flashcard question: ${effectiveStem}. Tap to reveal official answer.`
      }
      style={styles.flashcardContainer}
    >
      <View style={styles.flashcardHeaderRow}>
        <Text style={styles.flashcardOverline} numberOfLines={1}>
          {effectiveTitle.toUpperCase()}
        </Text>
        {sourcePage !== undefined ? (
          <CSCChipBadge label={`p. ${sourcePage}`} variant="neutral" />
        ) : null}
      </View>

      <Text style={styles.flashcardStem}>{effectiveStem}</Text>

      {!revealed ? (
        <View style={styles.flashcardPromptFooter}>
          <View style={styles.hairlineDivider} />
          <Text style={styles.flashcardTapPrompt}>Tap card to reveal answer</Text>
        </View>
      ) : (
        <Animated.View
          style={[
            styles.flashcardAnswerSection,
            {
              opacity: revealAnim,
              transform: [
                {
                  translateY: revealAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [motion.distance.subtle, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.hairlineDivider} />
          <Text style={styles.flashcardAnswerOverline}>OFFICIAL ANSWER</Text>
          <Text style={styles.flashcardCanonicalAnswer}>{effectiveAnswer}</Text>

          {effectiveExplanation ? (
            <View style={styles.flashcardExplanationBox}>
              <Text style={styles.flashcardExplanationTitle}>
                Canonical Explanation
              </Text>
              <Text style={styles.flashcardExplanationBody}>
                {effectiveExplanation}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </Pressable>
  );
};

// ============================================================================
// 7. AnswerFeedbackBanner
// ============================================================================
export interface AnswerFeedbackBannerProps {
  isCorrect: boolean;
  score: number;
  canonicalAnswer?: string | null;
}

export const AnswerFeedbackBanner: React.FC<AnswerFeedbackBannerProps> = ({
  isCorrect,
  score,
  canonicalAnswer,
}) => {
  const isPartial = !isCorrect && score > 0 && score < 1.0;

  let bg: string = colors.semantic.incorrect.surface;
  let border: string = colors.semantic.incorrect.border;
  let textColor: string = colors.semantic.incorrect.text;
  let headlineText = '✕ Incorrect';

  if (isCorrect) {
    bg = colors.semantic.correct.surface;
    border = colors.semantic.correct.border;
    textColor = colors.semantic.correct.text;
    headlineText = '✓ Correct Answer';
  } else if (isPartial) {
    bg = colors.semantic.warning.surface;
    border = colors.semantic.warning.border;
    textColor = colors.semantic.warning.text;
    headlineText = `! Partially Correct (${Math.round(score * 100)}%)`;
  }

  return (
    <View
      style={[
        styles.feedbackBanner,
        { backgroundColor: bg, borderColor: border },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.feedbackHeadline, { color: textColor }]}>
        {headlineText}
      </Text>
      {!isCorrect && canonicalAnswer ? (
        <Text style={[styles.feedbackSubtext, { color: textColor }]}>
          Official Answer: {canonicalAnswer}
        </Text>
      ) : null}
    </View>
  );
};

// ============================================================================
// 8. ContentCard & EvidenceCard
// ============================================================================
export interface ContentCardProps {
  overline?: string;
  title?: string;
  rightBadge?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  overline,
  title,
  rightBadge,
  children,
  style,
}) => (
  <View style={[styles.contentCard, style]}>
    {overline || title || rightBadge ? (
      <View style={styles.contentCardHeader}>
        <View style={{ flex: 1 }}>
          {overline ? (
            <Text style={styles.contentCardOverline}>{overline}</Text>
          ) : null}
          {title ? <Text style={styles.contentCardTitle}>{title}</Text> : null}
        </View>
        {rightBadge}
      </View>
    ) : null}
    {children}
  </View>
);

export interface EvidenceCardProps {
  retrievedPassage: RetrievedPassage;
}

export const EvidenceCard: React.FC<EvidenceCardProps> = ({
  retrievedPassage,
}) => {
  const { passage, strategy } = retrievedPassage;
  const pageLabel =
    passage.startPage === passage.endPage
      ? `p. ${passage.startPage}`
      : `pp. ${passage.startPage}–${passage.endPage}`;

  return (
    <View style={styles.evidenceContainer}>
      <View style={styles.evidenceAccentBar} />
      <View style={styles.evidenceContent}>
        <Text style={styles.evidenceQuoteText}>“{passage.text}”</Text>
        <View style={styles.evidenceMetaRow}>
          <Text style={styles.evidenceCitationText} numberOfLines={1}>
            {passage.section ? `${passage.chapter} · ${passage.section}` : passage.chapter}
          </Text>
          <CSCChipBadge
            label={`${pageLabel} · ${
              strategy === 'linked' ? 'Verified' : 'Reference'
            }`}
            variant="neutral"
          />
        </View>
      </View>
    </View>
  );
};

// ============================================================================
// 9. SubjectRow
// ============================================================================
export interface SubjectRowProps {
  summary?: TopicSummary;
  onPressTopic?: (topicId: string) => void;
  title?: string;
  answeredCount?: number;
  totalQuestions?: number;
  accuracyPercent?: number | null;
  onPress?: () => void;
  isLast?: boolean;
}

export const SubjectRow: React.FC<SubjectRowProps> = ({
  summary,
  onPressTopic,
  title,
  answeredCount: propAnsweredCount,
  totalQuestions: propTotalQuestions,
  accuracyPercent: propAccuracy,
  onPress,
  isLast = false,
}) => {
  const displayTitle = summary ? summary.topic.title : (title || '');
  const displayTotal = summary ? summary.totalQuestions : (propTotalQuestions || 0);
  const displayAnswered = summary ? summary.answeredCount : (propAnsweredCount || 0);
  const displayAccuracy = summary
    ? (summary.answeredCount > 0 ? Math.round((summary.correctCount / summary.answeredCount) * 100) : null)
    : (propAccuracy !== undefined ? propAccuracy : null);

  const remaining = Math.max(displayTotal - displayAnswered, 0);

  const handlePress = () => {
    if (summary && onPressTopic) {
      onPressTopic(summary.topic.id);
    } else if (onPress) {
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${displayTitle}. ${displayAnswered} of ${displayTotal} questions reviewed.${
        displayAccuracy !== null ? ` Accuracy ${displayAccuracy} percent.` : ''
      } Tap to practice this subject.`}
      style={({ pressed }) => [
        styles.subjectRow,
        !isLast && styles.subjectRowDivider,
        pressed && { backgroundColor: colors.neutral.surface },
      ]}
    >
      <View style={styles.subjectHeaderRow}>
        <Text style={styles.subjectTitle}>{displayTitle}</Text>
        {displayAccuracy !== null ? (
          <CSCChipBadge
            label={`${displayAccuracy}%`}
            variant={displayAccuracy >= 75 ? 'success' : 'warning'}
          />
        ) : (
          <CSCChipBadge label="New" variant="neutral" />
        )}
      </View>

      <View style={styles.subjectMetaRow}>
        <Text style={styles.subjectMetaText}>
          {displayAnswered} of {displayTotal} reviewed
        </Text>
        <Text style={styles.subjectMetaText}>
          {remaining > 0 ? `${remaining} remaining` : 'Complete'}
        </Text>
      </View>

      <AnimatedProgressBar
        current={displayAnswered}
        total={displayTotal}
        height={4}
      />
    </Pressable>
  );
};

// ============================================================================
// 10. EmptyState
// ============================================================================
export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  actionLabel,
  onAction,
}) => {
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
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
  },
  flexOne: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
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
    backgroundColor: glass.floatingBar.backgroundColor,
    borderTopWidth: borders.hairline,
    borderTopColor: glass.floatingBar.borderColor,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    shadowColor: glass.floatingBar.shadowColor,
    shadowOffset: glass.floatingBar.shadowOffset,
    shadowOpacity: glass.floatingBar.shadowOpacity,
    shadowRadius: glass.floatingBar.shadowRadius,
    elevation: glass.floatingBar.elevation,
  },
  liquidGlassTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: glass.header.backgroundColor,
    borderBottomWidth: borders.hairline,
    borderBottomColor: glass.header.borderColor,
    minHeight: 56,
  },
  bottomActionInner: {
    width: '100%',
  },
  buttonBase: {
    minHeight: controls.buttonHeight,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonSecondary: {
    backgroundColor: colors.neutral.canvas,
    borderWidth: borders.hairline,
    borderColor: colors.brand.border,
  },
  buttonSubtle: {
    backgroundColor: colors.neutral.surfaceMuted,
  },
  buttonDisabled: {
    backgroundColor: colors.neutral.surfaceMuted,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
  },
  buttonText: {
    ...typography.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  choiceRow: {
    minHeight: controls.choiceRowMinHeight,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  choiceKeyBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  choiceKeyText: {
    ...typography.subheadline,
    fontWeight: '700',
  },
  choiceTextWrapper: {
    flex: 1,
  },
  choiceText: {
    ...typography.body,
    color: colors.neutral.textPrimary,
  },
  choiceTextEmphasized: {
    fontWeight: '600',
  },
  choiceStatusCaption: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  chipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    marginRight: 6,
  },
  chipText: {
    ...typography.caption,
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
  flashcardContainer: {
    backgroundColor: colors.neutral.canvas,
    borderColor: colors.neutral.borderSubtle,
    borderWidth: borders.hairline,
    borderRadius: radius.card,
    padding: spacing.xxl,
    minHeight: 260,
    justifyContent: 'space-between',
    ...elevation.card,
  },
  flashcardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  flashcardOverline: {
    ...typography.caption,
    color: colors.brand.primary,
    flex: 1,
    marginRight: spacing.sm,
  },
  flashcardStem: {
    ...typography.title2,
    lineHeight: 30,
    color: colors.neutral.textPrimary,
    marginVertical: spacing.md,
  },
  flashcardPromptFooter: {
    marginTop: spacing.xl,
  },
  hairlineDivider: {
    height: borders.hairline,
    backgroundColor: colors.neutral.divider,
    marginVertical: spacing.base,
  },
  flashcardTapPrompt: {
    ...typography.subheadline,
    color: colors.brand.primary,
    textAlign: 'center',
    fontWeight: '600',
  },
  flashcardAnswerSection: {
    marginTop: spacing.sm,
  },
  flashcardAnswerOverline: {
    ...typography.caption,
    color: colors.semantic.correct.text,
    marginBottom: spacing.xs,
  },
  flashcardCanonicalAnswer: {
    ...typography.headline,
    color: colors.neutral.textPrimary,
    marginBottom: spacing.base,
  },
  flashcardExplanationBox: {
    backgroundColor: colors.neutral.surface,
    borderRadius: radius.control,
    padding: spacing.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
  },
  flashcardExplanationTitle: {
    ...typography.footnote,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
    marginBottom: spacing.xs,
  },
  flashcardExplanationBody: {
    ...typography.callout,
    color: colors.neutral.textPrimary,
  },
  feedbackBanner: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    marginTop: spacing.sm,
    marginBottom: spacing.base,
  },
  feedbackHeadline: {
    ...typography.subheadline,
    fontWeight: '700',
  },
  feedbackSubtext: {
    ...typography.footnote,
    marginTop: spacing.xs,
  },
  contentCard: {
    backgroundColor: colors.neutral.canvas,
    borderRadius: radius.card,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.base,
    marginBottom: spacing.base,
    ...elevation.card,
  },
  contentCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  contentCardOverline: {
    ...typography.caption,
    color: colors.neutral.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  contentCardTitle: {
    ...typography.headline,
    color: colors.neutral.textPrimary,
  },
  evidenceContainer: {
    flexDirection: 'row',
    backgroundColor: colors.neutral.canvas,
    borderRadius: radius.control,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...elevation.subtle,
  },
  evidenceAccentBar: {
    width: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
    marginRight: spacing.md,
  },
  evidenceContent: {
    flex: 1,
  },
  evidenceQuoteText: {
    ...typography.callout,
    color: colors.neutral.textPrimary,
    marginBottom: spacing.sm,
  },
  evidenceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  evidenceCitationText: {
    ...typography.footnote,
    color: colors.neutral.textSecondary,
    flex: 1,
  },
  subjectRow: {
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
  },
  subjectRowDivider: {
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.neutral.divider,
  },
  subjectHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  subjectTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  subjectMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  subjectMetaText: {
    ...typography.footnote,
    color: colors.neutral.textSecondary,
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
    ...typography.headline,
    color: colors.neutral.textPrimary,
    textAlign: 'center',
  },
  emptyStateMessage: {
    ...typography.subheadline,
    color: colors.neutral.textSecondary,
    textAlign: 'center',
  },
  emptyStateButton: {
    marginTop: spacing.sm,
  },
});
