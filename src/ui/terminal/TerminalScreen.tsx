import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SessionPresentation } from '../../liveHostSessions';
import type { TerminalRenderTarget } from '../../lib/terminalRenderer';
import type { TerminalSessionStatus } from '../../terminalSessions';
import { StatusGlyph } from '../herd/StatusGlyph';
import { fonts, palettes, radius, space, type } from '../theme/tokens';
import { TerminalSurface, type TerminalSurfaceHandle } from './TerminalSurface';

// The terminal is always charcoal: remote programs assume a dark screen, and
// the app chrome around it follows that rather than the system theme.
const p = palettes.dark;

type Props = {
  session: SessionPresentation | null;
  target: TerminalRenderTarget | null;
  fontSize: number;
  onBack: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onStatus: (terminalId: string, status: TerminalSessionStatus, error?: string) => void;
};

type Key = { label: string; data?: string; ctrl?: true; a11y: string };

const KEYS: Key[] = [
  { label: 'esc', data: '\u001b', a11y: 'Escape' },
  { label: 'tab', data: '\t', a11y: 'Tab' },
  { label: 'ctrl', ctrl: true, a11y: 'Control, applies to the next key' },
  { label: '^C', data: '\u0003', a11y: 'Interrupt' },
  { label: '↑', data: '\u001b[A', a11y: 'Up' },
  { label: '↓', data: '\u001b[B', a11y: 'Down' },
  { label: '←', data: '\u001b[D', a11y: 'Left' },
  { label: '→', data: '\u001b[C', a11y: 'Right' },
  { label: '⏎', data: '\r', a11y: 'Enter' },
];

function controlOf(data: string): string {
  if (data.length !== 1) return data;
  const code = data.toLowerCase().charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  if (data === ' ' || data === '@') return '\u0000';
  if (data === '[') return '\u001b';
  return data;
}

export function TerminalScreen({ session, target, fontSize, onBack, onSelectTerminal, onCloseTerminal, onStatus }: Props) {
  const surface = useRef<TerminalSurfaceHandle>(null);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);
  ctrlRef.current = ctrl;
  const [keyboard, setKeyboard] = useState(false);

  const terminals = session?.terminalRail.terminals ?? [];
  const activeId = target?.session.terminalId;
  const pane = useMemo(
    () => session?.snapshot.panes.find(candidate => candidate.pane_id === target?.session.paneId),
    [session, target],
  );
  const title = pane?.display_agent ?? pane?.agent ?? target?.session.title ?? 'Terminal';
  const status = target?.session.status;

  const transform = useCallback((data: string) => {
    if (!ctrlRef.current) return data;
    setCtrl(false);
    return controlOf(data);
  }, []);

  const press = (key: Key) => {
    if (key.ctrl) {
      setCtrl(value => !value);
      return;
    }
    if (key.data) surface.current?.send(ctrl ? controlOf(key.data) : key.data);
    setCtrl(false);
  };

  const toggleKeyboard = () => {
    if (keyboard) surface.current?.hideKeyboard();
    else surface.current?.showKeyboard();
    setKeyboard(!keyboard);
  };

  return (
    <View style={s.screen}>
      <View style={s.bar}>
        <Pressable onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Back to herd" hitSlop={8}>
          <Text style={s.backLabel}>‹ Herd</Text>
        </Pressable>
        <View style={s.titleWrap}>
          {pane && <StatusGlyph status={pane.agent_status} palette={p} />}
          <Text style={s.title} numberOfLines={1}>{title}</Text>
        </View>
        {session && <Text style={s.host} numberOfLines={1}>{session.host.name}</Text>}
      </View>

      {terminals.length > 1 && (
        <ScrollView horizontal style={s.rail} contentContainerStyle={s.railContent} showsHorizontalScrollIndicator={false}>
          {terminals.map(entry => {
            const active = entry.terminalId === activeId;
            return (
              <Pressable
                key={entry.terminalId}
                onPress={() => onSelectTerminal(entry.terminalId)}
                onLongPress={() => onCloseTerminal(entry.terminalId)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityHint="Long press to close"
                style={[s.railItem, active && s.railItemActive]}
              >
                <Text style={[s.railLabel, active && s.railLabelActive]} numberOfLines={1}>{entry.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={s.body}>
        {target ? (
          <TerminalSurface
            key={target.key}
            ref={surface}
            target={target}
            fontSize={fontSize}
            background={p.bg}
            transformInput={transform}
            onStatus={(next, error) => onStatus(target.session.terminalId, next, error)}
          />
        ) : (
          <View style={s.empty}>
            <Text style={s.emptyText}>No terminal open. Pick an agent in Herd to open its pane here.</Text>
            <Pressable onPress={onBack} style={s.emptyButton} accessibilityRole="button">
              <Text style={s.emptyButtonLabel}>Open Herd</Text>
            </Pressable>
          </View>
        )}
        {target && status !== 'connected' && (
          <View style={s.banner} pointerEvents="none">
            <Text style={s.bannerText}>
              {status === 'error'
                ? `Terminal failed${target.session.error ? `: ${target.session.error}` : ''}`
                : status === 'disconnected' ? 'Terminal closed. Reopen it from Herd.' : 'Attaching to pane'}
            </Text>
          </View>
        )}
      </View>

      {target && (
        <View style={s.keys}>
          <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={s.keysContent}>
            {KEYS.map(key => {
              const latched = key.ctrl && ctrl;
              return (
                <Pressable
                  key={key.label}
                  onPress={() => press(key)}
                  accessibilityRole="button"
                  accessibilityLabel={key.a11y}
                  accessibilityState={key.ctrl ? { selected: ctrl } : undefined}
                  style={({ pressed }) => [s.key, (pressed || latched) && s.keyPressed]}
                >
                  <Text style={[s.keyLabel, latched && s.keyLabelLatched]}>{key.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={toggleKeyboard}
            accessibilityRole="button"
            accessibilityLabel={keyboard ? 'Hide keyboard' : 'Show keyboard'}
            style={({ pressed }) => [s.type, pressed && s.keyPressed]}
          >
            <Text style={s.typeLabel}>{keyboard ? 'Done' : 'Type'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: p.seam,
  },
  back: { paddingVertical: space.xs },
  backLabel: { ...type.bodyMedium, color: p.muted },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  title: { ...type.bodyBold, color: p.text, flexShrink: 1 },
  host: { ...type.caption, color: p.muted, maxWidth: 120 },
  rail: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.seam },
  railContent: { paddingHorizontal: space.md, gap: space.xs, paddingVertical: space.xs },
  railItem: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.sm, maxWidth: 180 },
  railItemActive: { backgroundColor: p.surface },
  railLabel: { ...type.caption, color: p.muted },
  railLabelActive: { color: p.text },
  body: { flex: 1 },
  banner: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: p.surface,
  },
  bannerText: { ...type.caption, color: p.text },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xxl, gap: space.lg },
  emptyText: { ...type.body, color: p.muted },
  emptyButton: {
    alignSelf: 'flex-start',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: p.seam,
  },
  emptyButtonLabel: { ...type.bodyBold, color: p.text },
  keys: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: p.seam,
    backgroundColor: p.surface,
  },
  keysContent: { paddingHorizontal: space.sm, paddingVertical: space.sm, gap: 6 },
  key: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: space.sm,
    borderRadius: 8,
    backgroundColor: p.bg,
    alignItems: 'center',
  },
  keyPressed: { backgroundColor: p.seam },
  keyLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: p.text, fontVariant: ['no-contextual'] },
  keyLabelLatched: { fontFamily: fonts.bold },
  type: {
    paddingHorizontal: space.lg,
    alignSelf: 'stretch',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: p.seam,
  },
  typeLabel: { ...type.bodyBold, color: p.text },
});
