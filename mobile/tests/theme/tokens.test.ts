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

  it('verifies motion tokens match CSC spring and opacity specifications', () => {
    assert.equal(motion.opacity.resting, 1.0);
    assert.equal(motion.opacity.pressed, 0.88);
    assert.equal(motion.distance.subtle, 6);
    assert.equal(motion.distance.standard, 10);
    assert.equal(motion.spring.snappy.stiffness, 300);
    assert.equal(motion.spring.snappy.damping, 22);
    assert.equal(motion.spring.snappy.mass, 0.7);
    assert.equal(motion.duration.fast, 120);
    assert.equal(motion.duration.normal, 200);
  });

  it('verifies Apple HIG touch target >= 44pt', () => {
    assert.ok(controls.minTouchTarget >= 44);
    assert.ok(controls.minimumTouchTarget >= 44);
    assert.ok(controls.buttonHeight >= 44);
  });
});

