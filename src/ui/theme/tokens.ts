import { useColorScheme } from 'react-native';

// Gold marks only agents that need the user. Everything else stays in
// charcoal and fleece, so the count of gold glyphs is the count of work to do.

export type Palette = {
  bg: string;
  surface: string;
  seam: string;
  text: string;
  muted: string;
  /** Fill for stars and primary buttons. */
  gold: string;
  /** Gold used as text or a thin stroke; darker in light mode for contrast. */
  goldInk: string;
  onGold: string;
};

export const palettes: Readonly<Record<'dark' | 'light', Palette>> = {
  dark: {
    bg: '#1E1B19',
    surface: '#2B2724',
    seam: '#3D3833',
    text: '#EDE6DA',
    muted: '#9A9087',
    gold: '#F4B73A',
    goldInk: '#F4B73A',
    onGold: '#2B2724',
  },
  light: {
    bg: '#FBFAF7',
    surface: '#EFEBE4',
    seam: '#D9D2C7',
    text: '#2B2724',
    muted: '#6F665E',
    gold: '#F4B73A',
    goldInk: '#8A5A00',
    onGold: '#2B2724',
  },
};

export const fonts = {
  regular: 'JetBrainsMono-Regular',
  medium: 'JetBrainsMono-Medium',
  bold: 'JetBrainsMono-Bold',
} as const;

/** Passed to expo-font's useFonts. Each weight is its own family on Android. */
export const fontAssets = {
  [fonts.regular]: require('../../../assets/ui-fonts/JetBrainsMono-Regular.ttf') as number,
  [fonts.medium]: require('../../../assets/ui-fonts/JetBrainsMono-Medium.ttf') as number,
  [fonts.bold]: require('../../../assets/ui-fonts/JetBrainsMono-Bold.ttf') as number,
};

export const type = {
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  bodyBold: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  display: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const;

export const radius = { sm: 10, md: 16 } as const;

export function usePalette(): Palette {
  return useColorScheme() === 'light' ? palettes.light : palettes.dark;
}
