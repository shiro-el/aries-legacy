import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SessionPresentation } from '../../liveHostSessions';
import type { TerminalRenderTarget } from '../../lib/terminalRenderer';
import type { TerminalSessionStatus } from '../../terminalSessions';
import { ItemMenu, type ItemAction } from '../menus/ItemMenu';
import { StatusGlyph } from '../herd/StatusGlyph';
import { fonts, palettes, radius, space, type } from '../theme/tokens';
import { TerminalSurface, type TerminalSurfaceHandle } from './TerminalSurface';
import { EXTRA_KEY_ROWS, NO_MODIFIERS, keySequence, modifiedText, type ExtraKey, type Modifier, type Modifiers } from './terminalKeys';

// The terminal is always charcoal: remote programs assume a dark screen, and
// the app chrome around it follows that rather than the system theme.
const p = palettes.dark;

type Props = {
  session: SessionPresentation | null;
  target: TerminalRenderTarget | null;
  fontSize: number;
  onBack: () => void;
  onSelectTerminal: (terminalId: string) => void;
  terminalActions: (terminalId: string) => ItemAction[];
  onStatus: (terminalId: string, status: TerminalSessionStatus, error?: string) => void;
};

export function TerminalScreen({ session, target, fontSize, onBack, onSelectTerminal, terminalActions, onStatus }: Props) {
  const surface = useRef<TerminalSurfaceHandle>(null);
  // Ctrl and Alt latch for the next key, typed or tapped, then let go.
  const [modifiers, setModifiers] = useState<Modifiers>(NO_MODIFIERS);
  const modifiersRef = useRef(modifiers);
  modifiersRef.current = modifiers;
  const latch = (next: Modifiers) => {
    setModifiers(next);
    surface.current?.setModifierLatched(next.ctrl || next.alt);
  };

  const terminals = session?.terminalRail.terminals ?? [];
  const activeId = target?.session.terminalId;
  const pane = useMemo(
    () => session?.snapshot.panes.find(candidate => candidate.pane_id === target?.session.paneId),
    [session, target],
  );
  const title = pane?.display_agent ?? pane?.agent ?? target?.session.title ?? 'Terminal';
  const status = target?.session.status;

  const transform = useCallback((data: string) => {
    const held = modifiersRef.current;
    if (!held.ctrl && !held.alt) return data;
    setModifiers(NO_MODIFIERS);
    surface.current?.setModifierLatched(false);
    return modifiedText(data, held);
  }, []);

  const toggle = (modifier: Modifier) => latch({ ...modifiers, [modifier]: !modifiers[modifier] });

  const press = (key: Exclude<ExtraKey, { kind: 'modifier' }>) => {
    const handle = surface.current;
    if (!handle) return;
    handle.send(keySequence(key, modifiers, handle.applicationCursorKeys()));
    if (modifiers.ctrl || modifiers.alt) latch(NO_MODIFIERS);
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

      {terminals.length > 0 && (
        <ScrollView horizontal style={s.rail} contentContainerStyle={s.railContent} showsHorizontalScrollIndicator={false}>
          {terminals.map(entry => {
            const active = entry.terminalId === activeId;
            return (
              <ItemMenu
                label={entry.title}
                palette={p}
                actions={terminalActions(entry.terminalId)}
                key={entry.terminalId}
                onPress={() => onSelectTerminal(entry.terminalId)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[s.railItem, active && s.railItemActive]}
              >
                <Text style={[s.railLabel, active && s.railLabelActive]} numberOfLines={1}>{entry.title}</Text>
              </ItemMenu>
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
            onTap={() => surface.current?.showKeyboard()}
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
          {EXTRA_KEY_ROWS.map((row, index) => (
            <View key={index} style={s.keyRow}>
              {row.map(key => {
                const latched = key.kind === 'modifier' && modifiers[key.modifier];
                return (
                  <Pressable
                    key={key.label}
                    onPress={() => (key.kind === 'modifier' ? toggle(key.modifier) : press(key))}
                    accessibilityRole="button"
                    accessibilityLabel={key.a11y}
                    accessibilityState={key.kind === 'modifier' ? { selected: latched } : undefined}
                    style={({ pressed }) => [s.key, pressed && s.keyPressed, latched && s.keyLatched]}
                  >
                    <Text style={[s.keyLabel, latched && s.keyLabelLatched]} numberOfLines={1} adjustsFontSizeToFit>
                      {key.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: p.seam,
    backgroundColor: p.surface,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    gap: space.xs,
  },
  keyRow: { flexDirection: 'row', gap: space.xs },
  key: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    backgroundColor: p.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  keyPressed: { backgroundColor: p.seam },
  keyLatched: { backgroundColor: p.text },
  keyLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: p.text, fontVariant: ['no-contextual'] },
  keyLabelLatched: { fontFamily: fonts.bold, color: p.bg },
});
