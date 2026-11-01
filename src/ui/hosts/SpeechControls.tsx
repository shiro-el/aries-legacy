import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { hapticPress } from '../../services/interactionFeedback';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

export function SpeechAction({ label, onPress, disabled = false, selected, radio = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  radio?: boolean;
}) {
  const s = useSpeechStyles();
  return <Pressable accessibilityLabel={label} accessibilityRole={radio ? 'radio' : 'button'}
    accessibilityState={{ disabled, ...(radio ? { selected } : {}) }} disabled={disabled}
    onPress={hapticPress(onPress)}
    style={({ pressed }) => [s.action, selected && s.selected, disabled && s.disabled, pressed && s.pressed]}>
    <Text style={s.body}>{label}</Text>
  </Pressable>;
}

export function useSpeechStyles() {
  const palette = usePalette();
  return useMemo(() => makeStyles(palette), [palette]);
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    section: { gap: space.md, paddingTop: space.xxl },
    title: { ...type.title, color: p.text },
    label: { ...type.bodyBold, color: p.text },
    body: { ...type.body, color: p.text },
    hint: { ...type.caption, color: p.muted },
    error: { ...type.caption, color: p.removed },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    grow: { flex: 1, gap: space.xs },
    action: { minHeight: 48, justifyContent: 'center', paddingVertical: space.sm, paddingHorizontal: space.md,
      borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    selected: { backgroundColor: p.surface, borderColor: p.text },
    pressed: { backgroundColor: p.surface },
    disabled: { opacity: 0.45 },
    nested: { borderLeftWidth: 2, borderLeftColor: p.seam, paddingLeft: space.md },
    input: { ...type.body, color: p.text, minHeight: 48, padding: space.md,
      borderWidth: 1.5, borderColor: p.seam, borderRadius: radius.sm },
    previewInput: { minHeight: 112 },
    backdrop: { flex: 1, justifyContent: 'center', backgroundColor: '#00000080', padding: space.xl },
    dismiss: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    modal: { height: '80%', backgroundColor: p.bg, borderRadius: radius.md, padding: space.lg, gap: space.md },
    voiceRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.seam },
    voice: { flex: 1, minHeight: 64, padding: space.md, gap: space.xs, borderRadius: radius.sm },
  });
}
