import Svg, { Circle, Path } from 'react-native-svg';

import type { AgentStatus } from '../../types';
import type { Palette } from '../theme/tokens';

// The four-point star from the logo's Aries constellation.
const STAR = 'M12 0 Q13.8 10.2 24 12 Q13.8 13.8 12 24 Q10.2 13.8 0 12 Q10.2 10.2 12 0Z';

export const GLYPH_SIZE = 14;

export function StatusGlyph({ status, palette }: { status: AgentStatus; palette: Palette }) {
  switch (status) {
    case 'blocked':
      return (
        <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="-1 -1 26 26">
          <Path
            d={STAR}
            fill={palette.gold}
            stroke={palette.goldInk === palette.gold ? undefined : palette.goldInk}
            strokeWidth={1.5}
          />
        </Svg>
      );
    case 'done':
      return (
        <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="-1 -1 26 26">
          <Path d={STAR} fill="none" stroke={palette.goldInk} strokeWidth={2} />
        </Svg>
      );
    case 'working':
      return (
        <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="0 0 14 14">
          <Circle cx={7} cy={7} r={4.5} fill={palette.text} />
        </Svg>
      );
    case 'idle':
    case 'unknown':
      return (
        <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="0 0 14 14">
          <Circle
            cx={7}
            cy={7}
            r={4.5}
            fill={palette.bg}
            stroke={palette.muted}
            strokeWidth={1.5}
            strokeDasharray={status === 'unknown' ? [2, 2] : undefined}
          />
        </Svg>
      );
  }
}
