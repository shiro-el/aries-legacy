import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusGlyph } from './herd/StatusGlyph';
import { space, type, usePalette, type Palette } from './theme/tokens';

export type MainTab = 'herd' | 'calls' | 'hosts';

type Props = {
  tab: MainTab;
  needYou: number;
  /** Calls that arrived since Calls was last opened. */
  unseenCalls: number;
  onSelect: (tab: MainTab) => void;
};

/**
 * Words, not icons: three destinations, the herd carrying the gold count.
 * A terminal is not one of them; it opens from its pane in the herd.
 */
export function TabBar({ tab, needYou, unseenCalls, onSelect }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const items: { id: MainTab; label: string }[] = [
    { id: 'herd', label: 'Herd' },
    { id: 'calls', label: unseenCalls > 0 ? `Calls ${unseenCalls}` : 'Calls' },
    { id: 'hosts', label: 'Hosts' },
  ];
  return (
    <View style={s.bar} accessibilityRole="tablist">
      {items.map(item => {
        const active = item.id === tab;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.id === 'herd' && needYou > 0 ? `Herd, ${needYou} need you` : item.label}
            style={s.item}
          >
            <View style={s.labelRow}>
              {item.id === 'herd' && needYou > 0 && (
                <>
                  <StatusGlyph status="blocked" palette={palette} />
                  <Text style={s.count}>{needYou}</Text>
                </>
              )}
              <Text style={[s.label, active && s.labelActive]}>{item.label}</Text>
            </View>
            <View style={[s.mark, active && s.markActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.seam,
      backgroundColor: p.bg,
      paddingHorizontal: space.md,
    },
    item: { flex: 1, alignItems: 'center', paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { ...type.bodyMedium, color: p.muted },
    labelActive: { color: p.text, fontFamily: type.bodyBold.fontFamily },
    count: { ...type.bodyBold, color: p.goldInk },
    mark: { width: 18, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
    markActive: { backgroundColor: p.text },
  });
}
