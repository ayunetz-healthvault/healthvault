import { contrastRatio } from './contrast';
import { avatarColors, colors, density, palette, touchTarget, typography } from './tokens';

/**
 * The palette's accessibility rules, as tests rather than as a comment.
 *
 * A colour change is a one-line edit that looks harmless and can quietly put
 * secondary text below the legibility floor on one surface out of six. The
 * cross-product below is the only way that gets caught before a user with
 * reduced contrast sensitivity finds it.
 */

/** WCAG AA for body text. */
const AA_NORMAL = 4.5;
/** WCAG AA for text at 18pt+, and for the pressed/active states of controls. */
const AA_LARGE = 3;

/** Every background a foreground token can legally be placed on. */
const SURFACES = {
  background: colors.background,
  surface: colors.surface,
  surfaceMuted: colors.surfaceMuted,
  surfaceAccent: colors.surfaceAccent,
  surfaceQuiet: colors.surfaceQuiet,
  surfaceAppointment: colors.surfaceAppointment,
} as const;

/** Foregrounds that are used for text at body size on any of the above. */
const TEXT_ON_ANY_SURFACE = {
  textPrimary: colors.textPrimary,
  textSecondary: colors.textSecondary,
  textMuted: colors.textMuted,
  primary: colors.primary,
  danger: colors.danger,
  success: colors.success,
  info: colors.info,
  onSurfaceAppointment: colors.onSurfaceAppointment,
} as const;

describe('palette contrast', () => {
  describe.each(Object.entries(TEXT_ON_ANY_SURFACE))('%s', (_foregroundName, foreground) => {
    it.each(Object.entries(SURFACES))('clears AA on %s', (_surfaceName, surface) => {
      expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  it.each([
    ['onPrimary on primary', colors.onPrimary, colors.primary],
    ['onPrimary on primaryPressed', colors.onPrimary, colors.primaryPressed],
    ['onDanger on danger', colors.onDanger, colors.danger],
    ['onDanger on dangerPressed', colors.onDanger, colors.dangerPressed],
    ['onWarningSoft on warningSoft', colors.onWarningSoft, colors.warningSoft],
    ['onSuccessSoft on successSoft', colors.onSuccessSoft, colors.successSoft],
    ['onInfoSoft on infoSoft', colors.onInfoSoft, colors.infoSoft],
    ['textInverse on primary', colors.textInverse, colors.primary],
  ])('%s clears AA', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('gives every avatar colour a legible white initial', () => {
    for (const color of avatarColors) {
      expect(contrastRatio(colors.white, color)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  /**
   * A border is not text, so it only needs to be *visible* — but an invisible
   * card edge is why "which of these is a button?" gets asked.
   */
  it('keeps borders visible against the surfaces they divide', () => {
    expect(contrastRatio(colors.border, colors.surface)).toBeGreaterThanOrEqual(1.2);
    // Strictly stronger than the hairline, which is the only thing that makes
    // "this edge means something" readable without relying on colour.
    expect(contrastRatio(colors.borderStrong, colors.surface)).toBeGreaterThan(
      contrastRatio(colors.border, colors.surface),
    );
  });

  it('keeps the focus ring visible on the background it is drawn over', () => {
    expect(contrastRatio(colors.focusRing, colors.background)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('approved reference values', () => {
  /**
   * Pins the four tones the founder actually approved. If one of these has to
   * move, that is a design decision and should show up as a failing test, not
   * as a quiet diff.
   */
  it('ships the approved green, cream, peach and soft green unchanged', () => {
    expect(colors.primary).toBe('#145B48');
    expect(colors.background).toBe('#FFFCF6');
    expect(colors.surfaceAppointment).toBe('#FCE6C9');
    expect(colors.surfaceQuiet).toBe('#E8EDE0');
    expect(colors.textPrimary).toBe('#153C31');
  });

  /**
   * The reference's `#626D65` is the one approved value that was changed. This
   * records why, so nobody "restores" it.
   */
  it('records that the reference muted tone was below the floor on peach', () => {
    expect(contrastRatio('#626D65', colors.surfaceAppointment)).toBeLessThan(AA_NORMAL);
    expect(contrastRatio(colors.textSecondary, colors.surfaceAppointment)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });
});

describe('type scale and touch targets', () => {
  it('keeps every user-facing size at or above 14pt', () => {
    for (const style of Object.values(typography)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(14);
    }
  });

  it('keeps body text at or above the 17pt floor', () => {
    expect(typography.body.fontSize).toBeGreaterThanOrEqual(17);
    expect(typography.bodyStrong.fontSize).toBeGreaterThanOrEqual(17);
  });

  /**
   * The 1.4x rule is about paragraphs — text that wraps and is read in runs.
   * A 32pt display line or a 15pt single-line control label set at 1.4 would
   * just float apart, so those get a lower floor. Still a floor, because tight
   * leading on a heading that wraps to two lines is its own problem.
   */
  const RUNNING_TEXT = ['body', 'bodyStrong', 'callout', 'caption'] as const;

  it.each(Object.entries(typography))('gives %s enough leading', (name, style) => {
    const minimum = (RUNNING_TEXT as readonly string[]).includes(name) ? 1.4 : 1.2;
    expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps every touch target above the platform floors', () => {
    for (const size of Object.values(touchTarget)) {
      expect(size).toBeGreaterThanOrEqual(48);
    }
  });

  it('makes the comfortable density larger, never smaller', () => {
    expect(density.comfortable.fontScale).toBeGreaterThan(density.standard.fontScale);
    expect(density.comfortable.primaryActionHeight).toBeGreaterThanOrEqual(
      density.standard.primaryActionHeight,
    );
  });

  it('keeps the comfortable body size at the 18pt the reference asks for', () => {
    expect(typography.body.fontSize * density.comfortable.fontScale).toBeGreaterThanOrEqual(18);
  });
});

describe('palette hygiene', () => {
  it('uses #RRGGBB everywhere so the contrast rule can be applied to all of it', () => {
    for (const [name, value] of Object.entries(palette)) {
      expect(`${name}:${value}`).toMatch(/:#[0-9A-F]{6}$/i);
    }
  });
});
