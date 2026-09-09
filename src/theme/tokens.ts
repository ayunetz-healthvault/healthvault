/**
 * Design tokens.
 *
 * The palette is the direction approved in `docs/koode/DESIGN.md`: a deep
 * green on warm cream, with peach for appointment context and a soft green for
 * quiet supporting surfaces. The reference values are the named constants
 * below; where one of them could not clear this file's contrast floor it was
 * adjusted rather than shipped, and the adjustment is recorded at the value.
 *
 * Accessibility constraints this palette and scale are built around:
 *  - Body text is 17pt minimum (many users are 60+ or reading in a second
 *    language); nothing user-facing goes below 14pt.
 *  - Every interactive control is at least 56pt tall — comfortably above the
 *    44pt/48dp platform minimums, because these screens are often used one-
 *    handed and in a hurry.
 *  - Every foreground token clears 4.5:1 against *every* surface token it can
 *    legally sit on, not just against white. `tokens.test.ts` asserts this over
 *    the whole cross-product, so a future colour edit fails the suite rather
 *    than shipping a combination nobody checked.
 */

export const palette = {
  /**
   * Primary — the approved deep green, `#145B48`, with a ramp built around it.
   * Reads as "care" without the alarm of clinical blue.
   */
  primary900: '#0C3628',
  primary700: '#0F4838',
  primary600: '#145B48',
  primary500: '#1A6E58',
  primary200: '#A8C7BB',
  /** The approved soft green. Supporting surfaces and quiet status. */
  primary100: '#E8EDE0',
  primary50: '#F3F7F0',

  /**
   * Accent — the approved peach and its amber text partner. "Needs your
   * attention" and appointment context, never errors.
   */
  accent700: '#855016',
  accent500: '#A65F1D',
  accent100: '#FCE6C9',

  danger700: '#7A1717',
  danger500: '#8E1B1B',
  danger100: '#F7E1E1',

  success700: '#164C1A',
  success500: '#1B5E20',
  success100: '#E1F0E2',

  info700: '#153F6C',
  info500: '#1A4F86',
  info100: '#DEEAF7',

  /** The approved ink. */
  neutral900: '#153C31',
  neutral800: '#25453A',
  neutral700: '#3D5548',
  /**
   * Secondary text. Darker than the reference's `#626D65`, which reaches only
   * 4.44:1 on peach — just under the floor. This is the nearest tone that
   * clears 4.5:1 on every surface in the set, and is indistinguishable from the
   * reference value side by side.
   */
  neutral600: '#4E5950',
  /** Muted text. Same story as `neutral600`; the lighter of the two safe tones. */
  neutral500: '#5D675F',
  /** Below here the tones are for borders and fills only — never for text. */
  neutral400: '#9BA599',
  neutral300: '#C9CFC2',
  /** The approved hairline. */
  neutral200: '#E3E4DA',
  neutral100: '#EFF1E8',
  /** The approved warm background. */
  neutral50: '#FFFCF6',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const colors = {
  background: palette.neutral50,
  surface: palette.white,
  surfaceMuted: palette.neutral100,
  surfaceAccent: palette.primary50,
  /** Soft green. Quiet grouping and settled status. */
  surfaceQuiet: palette.primary100,
  /**
   * Peach. Appointment and review context.
   *
   * Always carries an explicit text label: the reference uses this tone to mean
   * two different things, and colour alone cannot say which.
   */
  surfaceAppointment: palette.accent100,
  /** Secondary text on peach. `textSecondary` also clears the floor there. */
  onSurfaceAppointment: palette.accent700,

  border: palette.neutral200,
  borderStrong: palette.neutral300,

  textPrimary: palette.neutral900,
  textSecondary: palette.neutral600,
  textMuted: palette.neutral500,
  textInverse: palette.white,

  primary: palette.primary600,
  primaryPressed: palette.primary700,
  primarySoft: palette.primary100,
  onPrimary: palette.white,

  danger: palette.danger500,
  dangerPressed: palette.danger700,
  dangerSoft: palette.danger100,
  onDanger: palette.white,

  warning: palette.accent500,
  warningSoft: palette.accent100,
  onWarningSoft: palette.accent700,

  success: palette.success500,
  successSoft: palette.success100,
  onSuccessSoft: palette.success700,

  info: palette.info500,
  infoSoft: palette.info100,
  onInfoSoft: palette.info700,

  focusRing: palette.accent500,
  overlay: 'rgba(18, 41, 31, 0.55)',

  // Absolutes, for the camera overlay where the background is the live preview
  // rather than a themed surface.
  white: palette.white,
  black: palette.black,
} as const;

/** 4pt base scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

/** Card corners follow the reference's generous 16–18pt. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  card: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Type scale. Line heights are generous (>=1.4) — dense text is the single
 * biggest readability complaint from older users.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 21, lineHeight: 28, fontWeight: '700' },
  subheading: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 17, lineHeight: 26, fontWeight: '600' },
  callout: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const;

/** Minimum hit area. Deliberately above the 44pt/48dp platform floors. */
export const touchTarget = {
  min: 56,
  comfortable: 64,
  large: 72,
} as const;

/**
 * The two reading densities.
 *
 * The reference sets the individual parent's phone in larger type with taller
 * primary actions — 18px body against 16px, a 58px main button — because that
 * screen is used by the person whose record it is, often the oldest user of the
 * two. That difference is preserved here as a multiplier rather than a second
 * type scale, so there is still one scale to change.
 *
 * The reference's 16px base is below this file's 17pt floor, so `standard`
 * keeps 17 and `comfortable` moves to 19. The *relative* emphasis matches; the
 * absolute floor wins where they disagree.
 *
 * This is a display preference attached to an experience, and nothing else. It
 * does not decide what anybody may read — that is the grant model — and no
 * screen branches on it for anything but sizing.
 */
export type Density = 'standard' | 'comfortable';

export const density = {
  standard: {
    /** Multiplier applied to the type scale. */
    fontScale: 1,
    /** Minimum height of the screen's primary action. */
    primaryActionHeight: touchTarget.min,
  },
  comfortable: {
    fontScale: 19 / 17,
    primaryActionHeight: 58,
  },
} as const satisfies Record<Density, { fontScale: number; primaryActionHeight: number }>;

export const elevation = {
  card: {
    shadowColor: palette.neutral900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  raised: {
    shadowColor: palette.neutral900,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

/** Distinct, WCAG-safe avatar backgrounds so profiles are told apart at a glance. */
export const avatarColors: readonly string[] = [
  palette.primary600,
  palette.info500,
  palette.accent700,
  '#5B4380',
  '#0F5A50',
  '#8E2159',
];

export const theme = {
  palette,
  colors,
  spacing,
  radius,
  typography,
  touchTarget,
  density,
  elevation,
  avatarColors,
} as const;

export type Theme = typeof theme;
