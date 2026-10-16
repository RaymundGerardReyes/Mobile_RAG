/**
 * CSC Anniversary Design System & Motion Tokens
 * 
 * Strict 80/15/5 visual weight distribution:
 * - 80% Calming Neutrals (surface & reading canvas)
 * - 15% Brand Deep Blue (#2A338F) for primary actions, structural hierarchy, and active states
 * - 5% Focal Accent Red (#EC1C2D) for key interactive focal points and bookmarks
 * 
 * Pure TypeScript — zero external UI library dependencies.
 */

export const colors = {
  // 80% Calming Neutrals
  neutral: {
    canvas: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F1F3F5',
    textPrimary: '#1A1D20',
    textSecondary: '#495057',
    textMuted: '#868E96',
    borderSubtle: '#E9ECEF',
    borderDefault: '#DEE2E6',
    borderStrong: '#CED4DA',
    backdrop: 'rgba(0, 0, 0, 0.45)',
  },

  // 15% CSC Anniversary Blue (Primary Identity)
  brand: {
    primary: '#2A338F',
    dark: '#1F266D',
    light: '#E8EAF6',
    tint: '#F0F2FA',
    border: '#C5CAE9',
    contrastText: '#FFFFFF',
  },

  // 5% Focal Accent Red (Bookmarks & Highlights)
  accent: {
    primary: '#EC1C2D',
    dark: '#C41524',
    light: '#FDE8E9',
    tint: '#FFF1F2',
    contrastText: '#FFFFFF',
  },

  // Semantic Status Colors
  semantic: {
    correct: {
      text: '#0F7B42',
      surface: '#EBF6F0',
      border: '#A3D9B8',
    },
    incorrect: {
      text: '#D92D20',
      surface: '#FEE4E2',
      border: '#FECDCA',
    },
    warning: {
      text: '#B76E00',
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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  emphasized: 1.5,
  focused: 2,
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
    lineHeight: 23,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  callout: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  subheadline: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '400' as const,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '400' as const,
  },
} as const;

export const controls = {
  minTouchTarget: 44,
  buttonHeight: 50,
  iconSmall: 16,
  iconMedium: 24,
  iconLarge: 32,
} as const;

export const motion = {
  duration: {
    instant: 0,
    fast: 120,
    normal: 200,
    medium: 240,
    slow: 300,
    deliberate: 350,
  },
  distance: {
    subtle: 4,
    standard: 8,
    pronounced: 16,
  },
  scale: {
    pressed: 0.98,
    active: 1.02,
    standard: 1.0,
  },
  spring: {
    snappy: { stiffness: 400, damping: 30, mass: 1 },
    bouncy: { stiffness: 300, damping: 20, mass: 1 },
    gentle: { stiffness: 200, damping: 25, mass: 1 },
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
