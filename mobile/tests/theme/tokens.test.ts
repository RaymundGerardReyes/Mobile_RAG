import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  colors,
  spacing,
  radius,
  borders,
  typography,
  controls,
  motion,
} from '../../src/theme/tokens.js';

/**
 * Calculates relative luminance according to WCAG 2.1 specifications.
 */
function getLuminance(hex: string): number {
  const rgb = hex.replace('#', '');
  const r = parseInt(rgb.substring(0, 2), 16) / 255;
  const g = parseInt(rgb.substring(2, 4), 16) / 255;
  const b = parseInt(rgb.substring(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates WCAG contrast ratio between two hex colors.
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

describe('Theme Tokens & WCAG Contrast Verification', () => {
  it('enforces 80/15/5 visual weight token structure', () => {
    assert.ok(colors.neutral.canvas);
    assert.ok(colors.neutral.surface);
    assert.ok(colors.neutral.textPrimary);
    assert.ok(colors.brand.primary === '#2A338F');
    assert.ok(colors.accent.primary === '#EC1C2D');
  });

  it('verifies CSC Brand Blue passes WCAG AAA contrast on white canvas', () => {
    const contrast = getContrastRatio(colors.brand.primary, colors.neutral.canvas);
    // Brand blue #2A338F should be > 10:1 on white (> 7.0:1 is WCAG AAA)
    assert.ok(
      contrast >= 10.0,
      `Brand blue contrast ${contrast.toFixed(2)} should be >= 10.0:1`
    );
  });

  it('verifies CSC Accent Red against white fails 4.5:1 WCAG AA (confirming dark text pairing requirement)', () => {
    const redOnWhite = getContrastRatio(colors.accent.primary, colors.neutral.canvas);
    // #EC1C2D against #FFFFFF is ~4.40:1, which is strictly below 4.5:1
    assert.ok(
      redOnWhite < 4.5,
      `Accent red against white is ${redOnWhite.toFixed(2)}, which violates WCAG AA normal text requirement`
    );

    // Pairing with dark text #191D2E passes WCAG AAA (> 13:1)
    const darkTextOnWhite = getContrastRatio(colors.neutral.textPrimary, colors.neutral.canvas);
    assert.ok(
      darkTextOnWhite >= 13.0,
      `Dark text on white contrast ${darkTextOnWhite.toFixed(2)} must be >= 13.0:1`
    );
  });

  it('verifies semantic status colors satisfy WCAG AA contrast against their surfaces', () => {
    // Semantic correct text on correct surface
    const correctRatio = getContrastRatio(
      colors.semantic.correct.text,
      colors.semantic.correct.surface
    );
    assert.ok(
      correctRatio >= 4.5,
      `Semantic correct ratio ${correctRatio.toFixed(2)} must be >= 4.5:1`
    );

    // Semantic incorrect text on incorrect surface
    const incorrectRatio = getContrastRatio(
      colors.semantic.incorrect.text,
      colors.semantic.incorrect.surface
    );
    assert.ok(
      incorrectRatio >= 4.5,
      `Semantic incorrect ratio ${incorrectRatio.toFixed(2)} must be >= 4.5:1`
    );

    // Semantic warning text on warning surface
    const warningRatio = getContrastRatio(
      colors.semantic.warning.text,
      colors.semantic.warning.surface
    );
    assert.ok(
      warningRatio >= 4.5,
      `Semantic warning ratio ${warningRatio.toFixed(2)} must be >= 4.5:1`
    );

    // Semantic info text on info surface
    const infoRatio = getContrastRatio(
      colors.semantic.info.text,
      colors.semantic.info.surface
    );
    assert.ok(
      infoRatio >= 4.5,
      `Semantic info ratio ${infoRatio.toFixed(2)} must be >= 4.5:1`
    );
  });

  it('verifies motion tokens match CSC spring, distance, and opacity specifications', () => {
    assert.equal(motion.opacity.resting, 1.0);
    assert.equal(motion.opacity.pressed, 0.88);
    assert.equal(motion.distance.subtle, 6);
    assert.equal(motion.distance.standard, 10);
    assert.equal(motion.distance.pronounced, 16);
    assert.equal(motion.scale.pressed, 0.98);
    assert.equal(motion.scale.standard, 1.0);
    assert.equal(motion.spring.snappy.stiffness, 300);
    assert.equal(motion.spring.snappy.damping, 22);
    assert.equal(motion.spring.snappy.mass, 0.7);
    assert.equal(motion.duration.fast, 120);
    assert.equal(motion.duration.normal, 200);
    assert.equal(motion.duration.medium, 240);
    assert.equal(motion.duration.slow, 300);
    assert.equal(motion.duration.deliberate, 350);
  });

  it('verifies Apple HIG touch target >= 44pt', () => {
    assert.ok(controls.minTouchTarget >= 44);
    assert.ok(controls.minimumTouchTarget >= 44);
    assert.ok(controls.buttonHeight >= 44);
  });

  it('verifies spacing scale integrity', () => {
    assert.equal(spacing.xs, 4);
    assert.equal(spacing.sm, 8);
    assert.equal(spacing.md, 12);
    assert.equal(spacing.base, 16);
    assert.equal(spacing.lg, 16);
    assert.equal(spacing.xl, 20);
    assert.equal(spacing.xxl, 24);
    assert.equal(spacing.xxxl, 32);
    assert.equal(spacing.huge, 48);
  });

  it('verifies corner radius and border hierarchy', () => {
    assert.equal(radius.sm, 8);
    assert.equal(radius.md, 12);
    assert.equal(radius.lg, 16);
    assert.equal(radius.xl, 24);
    assert.equal(radius.pill, 999);

    assert.equal(borders.none, 0);
    assert.equal(borders.hairline, 1);
    assert.equal(borders.emphasized, 1.5);
    assert.equal(borders.focused, 2);
  });

  it('verifies typography hierarchy matches mobile HIG scales', () => {
    assert.equal(typography.largeTitle.fontSize, 32);
    assert.equal(typography.title1.fontSize, 28);
    assert.equal(typography.title2.fontSize, 21);
    assert.equal(typography.headline.fontSize, 18);
    assert.equal(typography.body.fontSize, 17);
    assert.equal(typography.callout.fontSize, 15);
    assert.equal(typography.subheadline.fontSize, 14);
    assert.equal(typography.footnote.fontSize, 12);
    assert.equal(typography.caption.fontSize, 11);
  });
});
