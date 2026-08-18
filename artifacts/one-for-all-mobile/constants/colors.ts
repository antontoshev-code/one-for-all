/**
 * Semantic design tokens — synced from the One for All web app
 * (artifacts/one-for-all/src/index.css). Warm cream palette, sage primary.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#494036',
    tint: '#92977D',

    // Core surfaces — hsl(45 40% 98%) / hsl(30 15% 25%)
    background: '#FCFBF8',
    foreground: '#494036',

    card: '#FFFFFF',
    cardForeground: '#494036',

    // Primary — hsl(110 11% 54%) sage green
    primary: '#92977D',
    primaryForeground: '#FFFFFF',

    // Secondary / muted — hsl(40 20% 92%)
    secondary: '#EFECE7',
    secondaryForeground: '#494036',

    muted: '#EFECE7',
    mutedForeground: '#7A736C',

    accent: '#EFECE7',
    accentForeground: '#494036',

    // Destructive — hsl(0 45% 60%)
    destructive: '#C76B6B',
    destructiveForeground: '#FFFFFF',

    border: '#E5E2DC',
    input: '#E5E2DC',
  },

  dark: {
    text: '#F6F4EC',
    tint: '#7E8462',

    background: '#2A2622',
    foreground: '#F6F4EC',

    card: '#2F2B26',
    cardForeground: '#F6F4EC',

    primary: '#7E8462',
    primaryForeground: '#FFFFFF',

    secondary: '#464039',
    secondaryForeground: '#F6F4EC',

    muted: '#464039',
    mutedForeground: '#AFA69D',

    accent: '#464039',
    accentForeground: '#F6F4EC',

    destructive: '#8F3D3D',
    destructiveForeground: '#F6F4EC',

    border: '#464039',
    input: '#464039',
  },

  // Synced from web --radius: 1.25rem
  radius: 20,
};

export default colors;
