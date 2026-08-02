/**
 * Design tokens.
 *
 * Accessibility constraints this palette and scale are built around:
 *  - Body text is 17pt minimum (many users are 60+ or reading in a second
 *    language); nothing user-facing goes below 14pt.
 *  - Every interactive control is at least 56pt tall — comfortably above the
 *    44pt/48dp platform minimums, because these screens are often used one-
 *    handed and in a hurry.
 *  - Foreground/background pairs below hit >= 4.5:1 on white; the `on*` colours
 *    are the tested pairings.
 */

export const palette = {
  // Primary — a calm teal-green. Reads as "care" without the alarm of clinical blue.
  primary900: '#053A31',
  primary700: '#0B6B58',
  primary600: '#0E7C66',
  primary500: '#12907A',
  primary200: '#9AD7C8',
  primary100: '#D6EFE8',
  primary50: '#F0F8F5',

  // Accent — warm amber for "needs your attention", never for errors.
  accent700: '#8A4B04',
  accent500: '#C46A05',
  accent100: '#FDECD2',

  danger700: '#8E1B1B',
  danger500: '#C62828',
  danger100: '#FBE3E3',

  success700: '#1B5E20',
  success500: '#2E7D32',
  success100: '#E1F2E2',

  info700: '#1A4F86',
  info500: '#1E6BB8',
  info100: '#DCEBF9',

  neutral900: '#101614',
  neutral800: '#1E2A26',
  neutral700: '#3A4A45',
  neutral600: '#566661',
  neutral500: '#75857F',
  neutral400: '#A0AEA9',
  neutral300: '#C7D1CD',
  neutral200: '#E2E8E6',
  neutral100: '#F1F5F3',
  neutral50: '#F8FAF9',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const colors = {
  background: palette.neutral50,
  surface: palette.white,
  surfaceMuted: palette.neutral100,
  surfaceAccent: palette.primary50,

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

  focusRing: palette.primary500,
  overlay: 'rgba(16, 22, 20, 0.55)',

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

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
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
  '#6A4C93',
  '#00695C',
  '#AD1457',
];

export const theme = {
  palette,
  colors,
  spacing,
  radius,
  typography,
  touchTarget,
  elevation,
  avatarColors,
} as const;

export type Theme = typeof theme;
