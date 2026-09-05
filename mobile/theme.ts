// Design system tokens for the whole app - one place for color, spacing,
// radius and type so every screen reads as one considered thing instead of
// a pile of one-off hex codes and magic numbers (which is what App.tsx was
// before: '#22c55e'/'#71717a'/'#18181b' repeated ~60 times). Deliberately
// NOT the default Tailwind zinc/green dark-mode palette - a warmer, deeper
// near-black with a bespoke green and a distinct amber secondary accent
// (used for streaks/highlights so the whole app isn't monochrome green).

export const colors = {
  // Backgrounds - layered, not flat. bg0 is the app canvas, bg1 is a resting
  // card, bg2 is a card that sits on top of another card (nested elevation).
  bg0: '#0A0B0E',
  bg1: '#15171C',
  bg2: '#1D2027',
  bgInput: '#0E1013',
  border: '#272B33',
  borderStrong: '#343945',

  // Text hierarchy.
  text: '#F3F5F7',
  textDim: '#9AA1AD',
  textFaint: '#5B616D',

  // Brand: a warm-leaning, slightly desaturated green instead of the
  // ubiquitous Tailwind #22c55e, plus a tonal scale for gradients/pressed
  // states.
  accent: '#3ED598',
  accentDeep: '#1FAE79',
  accentSoft: 'rgba(62,213,152,0.14)',
  onAccent: '#04140D',

  // Secondary accent - amber, used for streaks/energy/points so the app
  // isn't monochrome-green. Distinct role from accent, not interchangeable.
  amber: '#FFB454',
  amberSoft: 'rgba(255,180,84,0.14)',

  // Semantic.
  danger: '#F0576B',
  dangerSoft: 'rgba(240,87,107,0.12)',
  warning: '#F0B429',
  warningSoft: 'rgba(240,180,41,0.12)',

  // Ranking (leaderboard podium).
  gold: '#F2C14E',
  silver: '#C9CED6',
  bronze: '#D0894F',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
};

// Font families - registered in App.tsx via useFonts() before first render.
// Sora (geometric, confident) carries display numbers/headings; Manrope
// (warm humanist sans) carries everything read as a sentence. Two families
// used deliberately, not one font stretched across every role.
export const font = {
  display: 'Sora_800ExtraBold',
  displaySemi: 'Sora_600SemiBold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyExtraBold: 'Manrope_800ExtraBold',
};

// Soft shadow presets (iOS shadow* + Android elevation) for the few
// surfaces that should visibly lift off the background - primary CTA and
// the live-run stats panel - rather than every card, so elevation still
// reads as a signal instead of wallpaper.
export const shadow = {
  raised: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  soft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
};
