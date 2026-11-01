import { View } from 'react-native';

type Fade = { duration: (ms: number) => Fade };
// Layout animations only change how a view arrives, so tests render it plainly.
const fade: Fade = { duration: () => fade };

export const reanimatedFadeMock = {
  __esModule: true,
  default: { View },
  FadeIn: fade,
  FadeOut: fade,
};
