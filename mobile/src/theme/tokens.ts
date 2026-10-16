/**
 * CSC Anniversary Design System & Motion Tokens
 * Strict 80/15/5 visual weight distribution:
 * - 80% Calming Neutrals (#FFFFFF / #F7F8FC surfaces & #E4E7EF subtle borders)
 * - 15% Brand Deep Blue (#2A338F) for primary actions, structural hierarchy, and active states
 * - 5% Focal Accent Red (#EC1C2D) for small emphasis badges and priority indicators ONLY
 *
 * Pure TypeScript — zero external UI library dependencies.
 */

export const colors = {
  // 80% Calming Neutrals
  neutral: {
    canvas: '#FFFFFF',
    surface: '#F7F8FC',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F1F3F9',
    textPrimary: '#191D2E',
    textSecondary: '#62697B',
    textMuted: '#868E96',
    borderSubtle: '#E4E7EF',
    borderDefault: '#DEE2E6',
    divider: '#E8EAF1',
    borderStrong: '#CED4DA',
    backdrop: 'rgba(25, 29, 46, 0.45)',
  },

  // 15% CSC Anniversary Blue (Primary Identity — 10.67:1 contrast on white)
  brand: {
    primary: '#2A338F',
    dark: '#1F266D',
    light: '#E8EAF6',
    tint: '#F0F2FA',
    border: '#C5CAE9',
    contrastText: '#FFFFFF',
  },

  // 5% Focal Accent Red (4.40:1 contrast on white — pair with dark text or use as border/dot accent)
  accent: {
    primary: '#EC1C2D',
    dark: '#C41524',
    light: '#FDE8E9',
    tint: '#FFF5F5',
    contrastText: '#FFFFFF',
  },

  // Semantic Status Colors (Reserved strictly for grading, warnings, and system states)
  semantic: {
    correct: {
      text: '#166534',
      surface: '#EBF6F0',
      border: '#A3D9B8',
    },
    incorrect: {
      text: '#B42318',
      surface: '#FEE4E2',
      border: '#FECDCA',
    },
    warning: {
      text: '#92400E',
      surface: '#FEF7EA',
      border: '#F6D090',
    },
    info: {
      text: '#175CD3',
      surface: '#EFF4FF',
      border: '#B2CCFF',
    },
  },
} as const;

export const spacing = {
  xs: 4,       // space-1: 4pt icon-to-label micro spacing
  sm: 8,       // space-2: 8pt tight internal spacing
  md: 12,      // space-3: 12pt compact component padding
  base: 16,    // space-4: 16pt standard screen gutters & card padding
  lg: 16,      // alias for 16pt
  xl: 20,      // space-5: 20pt form groups & generous padding
  xxl: 24,     // space-6: 24pt major section separation
  xxxl: 32,    // space-8: 32pt large visual breaks
  huge: 48,    // space-12: 48pt spacious hero sections
  section: 48,
} as const;

export const radius = {
  sm: 8,     // 8pt: Small badges, compact chips
  md: 12,    // 12pt: Standard controls, inputs, buttons, choice rows
  lg: 16,    // 16pt: Main structured cards
  xl: 24,    // 24pt: Bottom sheets & large feature panels
  pill: 999, // Fully rounded pills
} as const;

export const borders = {
  none: 0,
  hairline: 1,     // 1pt: Default card outlines, input borders, subtle dividers
  emphasized: 1.5, // 1.5pt: Selected control outline
  focused: 2,      // 2pt: High-emphasis focus or selection state
} as const;

export const typography = {
  largeTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
  },
  title1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
  },
  title2: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '600' as const,
  },
  headline: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  callout: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400' as const,
  },
  subheadline: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as const,
  },
} as const;

export const controls = {
  minTouchTarget: 44,
  minimumTouchTarget: 44,
  buttonHeight: 50,
  iconSmall: 16,
  iconMedium: 24,
  iconLarge: 32,
} as const;

export const motion = {
  duration: {
    instant: 120,      // 100-140ms: Button presses, icon feedback, opacity changes
    fast: 120,
    normal: 200,       // 180-240ms: Content appearance, small panels, toggles
    medium: 240,       // 180-240ms: Card entrances
    slow: 300,         // 250-350ms: Custom fades, screen transitions
    deliberate: 350,   // 300-400ms: Bottom sheets & large overlays
  },
  distance: {
    subtle: 6,         // 6pt vertical movement on card entrance
    standard: 10,      // 10pt vertical movement
    pronounced: 16,
  },
  scale: {
    pressed: 0.98,     // 1.00 -> 0.98 button & choice press scale
    active: 1.02,
    standard: 1.0,
  },
  opacity: {
    resting: 1.0,
    pressed: 0.88,     // 1.00 -> 0.88 button press opacity
  },
  spring: {
    snappy: { stiffness: 300, damping: 22, mass: 0.7 }, // Exact CSC Button spec spring
    bouncy: { stiffness: 300, damping: 20, mass: 1 },
    gentle: { stiffness: 200, damping: 25, mass: 1 },
  },
  policy: {
    navigation: 'native',
    content: 'subtle',
    decorative: 'minimal',
    reducedMotion: 'crossFadeOrImmediate',
  },
} as const;

export type ThemeTokens = {
  colors: typeof colors;
  spacing: typeof spacing;
  radius: typeof radius;
  borders: typeof borders;
  typography: typeof typography;
  controls: typeof controls;
  motion: typeof motion;
};
