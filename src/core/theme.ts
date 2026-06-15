/**
 * Freedom Ledger — Theme tokens
 * Dark-mode-first. A calm but serious personal financial command center.
 */

export const colors = {
  // Surfaces
  bg: '#12141C',
  card: '#222634',
  cardAlt: '#2D3345',
  cardElevated: '#343B50',
  border: '#3A4256',
  divider: '#2A2F3D',

  // Text
  text: '#F2F5FA',
  textMuted: '#AAB2C4',
  textFaint: '#7C8493',

  // Accents
  accent: '#58A6FF',       // primary blue
  success: '#4CC982',      // green
  warning: '#F59E0B',      // orange
  danger: '#EF5C5C',       // red
  foundation: '#A67BFF',   // purple — retirement / foundation

  // Risk scale (maps to CJBotResponse.riskLevel)
  riskSafe: '#4CC982',
  riskCaution: '#F59E0B',
  riskRisky: '#F97316',
  riskUrgent: '#EF5C5C',

  // Soft tints
  overlay: 'rgba(8, 9, 13, 0.72)',
  accentSoft: 'rgba(88, 166, 255, 0.12)',
  successSoft: 'rgba(76, 201, 130, 0.12)',
  warningSoft: 'rgba(245, 158, 11, 0.12)',
  dangerSoft: 'rgba(239, 92, 92, 0.12)',
  foundationSoft: 'rgba(166, 123, 255, 0.12)',
  transparent: 'transparent',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  hero: { fontSize: 38, fontWeight: '800' as const, letterSpacing: -1 },
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '700' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  money: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -1 },
  moneyLg: { fontSize: 44, fontWeight: '800' as const, letterSpacing: -1.5 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

export type AppColors = typeof colors;
