import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { StatusGlyph } from '../herd/StatusGlyph';
import { URGENCY_LABEL } from './callView';
import type { ArrivedCall } from './useHostCalls';

type Props = {
  arrived: ArrivedCall | null;
  hostName: (hostId: string) => string;
  /** Opens the call's pane, or Calls once the pane is gone. */
  onOpen: (arrived: ArrivedCall) => void;
  onDismiss: () => void;
};

const SHOWN_MS = 12_000;

/** A call that arrives while the app is open, above whatever is on screen. */
export function CallBanner({ arrived, hostName, onOpen, onDismiss }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(onDismiss, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [arrived, onDismiss]);

  if (!arrived) return null;
  const { call } = arrived;
  const title = call.title || (call.kind === 'approval' ? 'Waiting for approval' : 'An agent is calling you');
  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.banner} accessibilityLiveRegion="polite">
        <Pressable
          onPress={() => onOpen(arrived)}
          accessibilityRole="button"
          accessibilityLabel={`${URGENCY_LABEL[call.urgency]} call from ${hostName(arrived.hostId)}: ${title}. Open`}
          style={s.main}
        >
          <View style={s.head}>
            <StatusGlyph status="blocked" palette={palette} />
            <Text style={s.meta} numberOfLines={1}>
              {URGENCY_LABEL[call.urgency]}, {hostName(arrived.hostId)}
            </Text>
          </View>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          {call.body ? <Text style={s.body} numberOfLines={2}>{call.body}</Text> : null}
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8} style={s.close}>
          <Text style={s.closeLabel}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { position: 'absolute', top: 0, left: 0, right: 0, padding: space.md, zIndex: 10 },
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: p.surface,
      borderWidth: 1.5,
      borderColor: p.goldInk,
      elevation: 6,
    },
    main: { flex: 1, gap: 2 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    meta: { ...type.caption, color: p.muted, flexShrink: 1 },
    title: { ...type.bodyBold, color: p.text },
    body: { ...type.body, color: p.text },
    close: { paddingVertical: 2, paddingHorizontal: space.xs },
    closeLabel: { ...type.caption, color: p.muted },
  });
}
