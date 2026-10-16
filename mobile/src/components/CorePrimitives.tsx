import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { borders, colors, controls, motion, radius, spacing, typography } from '../theme/tokens.js';

/**
 * Custom hook respecting system-wide Accessibility "Reduce Motion" setting.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled: boolean) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) setReduceMotion(enabled);
      }
    );

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  return reduceMotion;
}

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger';

export interface CSCButtonProps {
  title: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Tactile CSC Button with Apple HIG touch target >= 44pt,
 * 120ms opacity feedback, and spring scale animation.
 * Falls back to 120ms opacity cross-fade when Reduce Motion is enabled.
 */
export function CSCButton({
  title,
  variant = 'primary',
  disabled = false,
  loading = false,
  onPress,
  accessibilityLabel,
  style,
  textStyle,
}: CSCButtonProps) {
  const reducedMotion = useReducedMotion();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(motion.opacity.resting)).current;

  const handlePressIn = () => {
    if (disabled || loading) return;

    if (reducedMotion) {
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.pressed,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: motion.scale.pressed,
        useNativeDriver: true,
        stiffness: motion.spring.snappy.stiffness,
        damping: motion.spring.snappy.damping,
        mass: motion.spring.snappy.mass,
      }),
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.pressed,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    if (disabled || loading) return;

    if (reducedMotion) {
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.resting,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: motion.scale.standard,
        useNativeDriver: true,
        stiffness: motion.spring.snappy.stiffness,
        damping: motion.spring.snappy.damping,
        mass: motion.spring.snappy.mass,
      }),
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.resting,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isAccent = variant === 'accent';
  const isDanger = variant === 'danger';

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.buttonBase,
          isPrimary && styles.buttonPrimary,
          isSecondary && styles.buttonSecondary,
          isAccent && styles.buttonAccent,
          isDanger && styles.buttonDanger,
          disabled && styles.buttonDisabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={isPrimary || isAccent ? colors.brand.contrastText : colors.brand.primary}
          />
        ) : (
          <Text
            style={[
              styles.buttonTextBase,
              isPrimary && styles.buttonTextPrimary,
              isSecondary && styles.buttonTextSecondary,
              isAccent && styles.buttonTextAccent,
              isDanger && styles.buttonTextDanger,
              disabled && styles.buttonTextDisabled,
              textStyle,
            ]}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

export interface ContentCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delayMs?: number;
}

/**
 * Structured 16pt radius Content Card with subtle hairline border
 * and 6pt vertical entrance offset with Easing.out(Easing.cubic).
 */
export function ContentCard({ children, style, delayMs = 0 }: ContentCardProps) {
  const reducedMotion = useReducedMotion();
  const opacityAnim = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translateYAnim = useRef(new Animated.Value(reducedMotion ? 0 : motion.distance.subtle)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacityAnim.setValue(1);
      translateYAnim.setValue(0);
      return;
    }

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: motion.duration.normal,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: motion.duration.normal,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [reducedMotion, delayMs]);

  return (
    <Animated.View
      style={[
        styles.cardBase,
        {
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export type ChipBadgeVariant = 'neutral' | 'brand' | 'accentRed' | 'success' | 'warning';

export interface CSCChipBadgeProps {
  label: string;
  variant?: ChipBadgeVariant;
  indicatorDot?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

/**
 * Accessible 8pt radius badge supporting neutral, brand blue, and 5% CSC Red dot/border accent.
 * Ensures 100% WCAG AA contrast compliance by pairing accent red with dark primary text.
 */
export function CSCChipBadge({
  label,
  variant = 'neutral',
  indicatorDot = false,
  style,
  textStyle,
  accessibilityLabel,
}: CSCChipBadgeProps) {
  const isAccentRed = variant === 'accentRed';
  const showDot = indicatorDot || isAccentRed;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel || label}
      style={[
        styles.chipBadgeBase,
        variant === 'neutral' && styles.chipBadgeNeutral,
        variant === 'brand' && styles.chipBadgeBrand,
        variant === 'accentRed' && styles.chipBadgeAccentRed,
        variant === 'success' && styles.chipBadgeSuccess,
        variant === 'warning' && styles.chipBadgeWarning,
        style,
      ]}
    >
      {showDot && (
        <View
          style={[
            styles.chipBadgeDot,
            variant === 'neutral' && styles.chipBadgeDotNeutral,
            variant === 'brand' && styles.chipBadgeDotBrand,
            variant === 'accentRed' && styles.chipBadgeDotAccentRed,
            variant === 'success' && styles.chipBadgeDotSuccess,
            variant === 'warning' && styles.chipBadgeDotWarning,
          ]}
        />
      )}
      <Text
        style={[
          styles.chipBadgeTextBase,
          variant === 'neutral' && styles.chipBadgeTextNeutral,
          variant === 'brand' && styles.chipBadgeTextBrand,
          variant === 'accentRed' && styles.chipBadgeTextAccentRed,
          variant === 'success' && styles.chipBadgeTextSuccess,
          variant === 'warning' && styles.chipBadgeTextWarning,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export interface AnimatedChoiceRowProps {
  choiceKey: string;
  text: string;
  selected: boolean;
  disabled?: boolean;
  isCorrect?: boolean;
  isIncorrect?: boolean;
  onPress: () => void;
  index?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Tactile 12pt radius multiple-choice row with 120ms press feedback,
 * semantic grading states, and optional staggered entrance.
 */
export function AnimatedChoiceRow({
  choiceKey,
  text,
  selected,
  disabled = false,
  isCorrect = false,
  isIncorrect = false,
  onPress,
  index = 0,
  accessibilityLabel,
  style,
  textStyle,
}: AnimatedChoiceRowProps) {
  const reducedMotion = useReducedMotion();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(motion.opacity.resting)).current;
  const entranceAnim = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      entranceAnim.setValue(1);
      return;
    }
    const timer = setTimeout(() => {
      Animated.timing(entranceAnim, {
        toValue: 1,
        duration: motion.duration.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, index * 40);

    return () => clearTimeout(timer);
  }, [reducedMotion, index]);

  const handlePressIn = () => {
    if (disabled) return;

    if (reducedMotion) {
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.pressed,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: motion.scale.pressed,
        useNativeDriver: true,
        stiffness: motion.spring.snappy.stiffness,
        damping: motion.spring.snappy.damping,
        mass: motion.spring.snappy.mass,
      }),
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.pressed,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    if (disabled) return;

    if (reducedMotion) {
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.resting,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: motion.scale.standard,
        useNativeDriver: true,
        stiffness: motion.spring.snappy.stiffness,
        damping: motion.spring.snappy.damping,
        mass: motion.spring.snappy.mass,
      }),
      Animated.timing(opacityAnim, {
        toValue: motion.opacity.resting,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const choiceStateLabel = isCorrect
    ? 'Correct'
    : isIncorrect
    ? 'Incorrect'
    : selected
    ? 'Selected'
    : '';

  return (
    <Animated.View
      style={[
        {
          transform: [
            { scale: scaleAnim },
            {
              translateY: entranceAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [motion.distance.subtle, 0],
              }),
            },
          ],
          opacity: Animated.multiply(opacityAnim, entranceAnim),
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={accessibilityLabel || `${choiceKey}: ${text} ${choiceStateLabel}`}
        accessibilityState={{
          checked: selected,
          disabled,
        }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.choiceRowBase,
          selected && styles.choiceRowSelected,
          isCorrect && styles.choiceRowCorrect,
          isIncorrect && styles.choiceRowIncorrect,
        ]}
      >
        <View
          style={[
            styles.choiceKeyBadge,
            selected && styles.choiceKeyBadgeSelected,
            isCorrect && styles.choiceKeyBadgeCorrect,
            isIncorrect && styles.choiceKeyBadgeIncorrect,
          ]}
        >
          <Text
            style={[
              styles.choiceKeyText,
              selected && styles.choiceKeyTextSelected,
              isCorrect && styles.choiceKeyTextCorrect,
              isIncorrect && styles.choiceKeyTextIncorrect,
            ]}
          >
            {choiceKey}
          </Text>
        </View>
        <Text style={[styles.choiceText, textStyle]}>{text}</Text>
        {isCorrect && <Text style={styles.choiceStatusIcon}>✓</Text>}
        {isIncorrect && <Text style={[styles.choiceStatusIcon, styles.choiceStatusIconIncorrect]}>✕</Text>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Reusable alias matching the design specification.
 */
export const AnimatedChoiceCard = AnimatedChoiceRow;

export interface AnimatedProgressBarProps {
  progress?: number;
  current?: number;
  total?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  barColor?: string;
  trackColor?: string;
  accessibilityLabel?: string;
}

/**
 * Smooth 200ms ease-out progress bar using useNativeDriver: true.
 * Respects system Reduce Motion settings.
 */
export function AnimatedProgressBar({
  progress,
  current,
  total,
  height = 6,
  style,
  barColor = colors.brand.primary,
  trackColor = colors.neutral.borderSubtle,
  accessibilityLabel,
}: AnimatedProgressBarProps) {
  const reducedMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState<number>(300);

  const ratio = Math.max(
    0,
    Math.min(
      1,
      total !== undefined && total > 0 && current !== undefined
        ? current / total
        : progress ?? 0
    )
  );

  const animValue = useRef(new Animated.Value(ratio)).current;

  useEffect(() => {
    if (reducedMotion) {
      animValue.setValue(ratio);
      return;
    }

    Animated.timing(animValue, {
      toValue: ratio,
      duration: motion.duration.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [ratio, reducedMotion]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== trackWidth) {
      setTrackWidth(w);
    }
  };

  const percentage = Math.round(ratio * 100);

  return (
    <View
      onLayout={handleLayout}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel || `Progress ${percentage}%`}
      accessibilityValue={{ min: 0, max: 100, now: percentage }}
      style={[
        styles.progressTrack,
        {
          height,
          backgroundColor: trackColor,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.progressFill,
          {
            height,
            backgroundColor: barColor,
            transform: [
              {
                translateX: animValue.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-trackWidth, 0],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    minHeight: controls.buttonHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonPrimary: {
    backgroundColor: colors.brand.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.neutral.surface,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
  },
  buttonAccent: {
    backgroundColor: colors.accent.primary,
  },
  buttonDanger: {
    backgroundColor: colors.semantic.incorrect.surface,
    borderWidth: borders.hairline,
    borderColor: colors.semantic.incorrect.border,
  },
  buttonDisabled: {
    backgroundColor: colors.neutral.surfaceMuted,
    borderColor: colors.neutral.borderSubtle,
    borderWidth: borders.hairline,
  },
  buttonTextBase: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonTextPrimary: {
    color: colors.brand.contrastText,
  },
  buttonTextSecondary: {
    color: colors.neutral.textPrimary,
  },
  buttonTextAccent: {
    color: colors.accent.contrastText,
  },
  buttonTextDanger: {
    color: colors.semantic.incorrect.text,
  },
  buttonTextDisabled: {
    color: colors.neutral.textMuted,
  },
  cardBase: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.base,
  },
  chipBadgeBase: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: borders.hairline,
  },
  chipBadgeNeutral: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderColor: colors.neutral.borderSubtle,
  },
  chipBadgeBrand: {
    backgroundColor: colors.brand.tint,
    borderColor: colors.brand.border,
  },
  chipBadgeAccentRed: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderColor: colors.accent.primary,
  },
  chipBadgeSuccess: {
    backgroundColor: colors.semantic.correct.surface,
    borderColor: colors.semantic.correct.border,
  },
  chipBadgeWarning: {
    backgroundColor: colors.semantic.warning.surface,
    borderColor: colors.semantic.warning.border,
  },
  chipBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    marginRight: spacing.xs,
  },
  chipBadgeDotNeutral: {
    backgroundColor: colors.neutral.textSecondary,
  },
  chipBadgeDotBrand: {
    backgroundColor: colors.brand.primary,
  },
  chipBadgeDotAccentRed: {
    backgroundColor: colors.accent.primary,
  },
  chipBadgeDotSuccess: {
    backgroundColor: colors.semantic.correct.text,
  },
  chipBadgeDotWarning: {
    backgroundColor: colors.semantic.warning.text,
  },
  chipBadgeTextBase: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
  },
  chipBadgeTextNeutral: {
    color: colors.neutral.textSecondary,
  },
  chipBadgeTextBrand: {
    color: colors.brand.primary,
  },
  chipBadgeTextAccentRed: {
    color: colors.neutral.textPrimary, // WCAG AA 100% compliant dark text
  },
  chipBadgeTextSuccess: {
    color: colors.semantic.correct.text,
  },
  chipBadgeTextWarning: {
    color: colors.semantic.warning.text,
  },
  choiceRowBase: {
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
  choiceKeyBadgeCorrect: {
    backgroundColor: colors.semantic.correct.border,
    borderColor: colors.semantic.correct.text,
  },
  choiceKeyBadgeIncorrect: {
    backgroundColor: colors.semantic.incorrect.border,
    borderColor: colors.semantic.incorrect.text,
  },
  choiceKeyText: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  choiceKeyTextSelected: {
    color: colors.brand.contrastText,
  },
  choiceKeyTextCorrect: {
    color: colors.semantic.correct.text,
  },
  choiceKeyTextIncorrect: {
    color: colors.semantic.incorrect.text,
  },
  choiceText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.neutral.textPrimary,
    lineHeight: typography.body.lineHeight,
  },
  choiceStatusIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.semantic.correct.text,
  },
  choiceStatusIconIncorrect: {
    color: colors.semantic.incorrect.text,
  },
  progressTrack: {
    width: '100%',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    width: '100%',
    borderRadius: radius.pill,
  },
});
