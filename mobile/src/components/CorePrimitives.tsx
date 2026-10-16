import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
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
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
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
 * Tactile CSC Button with Apple HIG touch target >= 44pt and spring press feedback.
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

  const handlePressIn = () => {
    if (disabled || loading || reducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.pressed,
      useNativeDriver: true,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || loading || reducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: motion.scale.standard,
      useNativeDriver: true,
      stiffness: motion.spring.snappy.stiffness,
      damping: motion.spring.snappy.damping,
      mass: motion.spring.snappy.mass,
    }).start();
  };

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isAccent = variant === 'accent';
  const isDanger = variant === 'danger';

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
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
 * Structured 16pt radius Content Card with subtle hairline border.
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
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: motion.duration.normal,
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
});

