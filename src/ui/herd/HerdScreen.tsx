import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemMenu, type ItemAction } from '../menus/ItemMenu';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { GLYPH_SIZE, StatusGlyph } from './StatusGlyph';
import type { HerdSection } from './herdSections';
import type { HerdPane, HerdTab } from './herdView';

export type SavedHost = { hostId: string; name: string; connecting: boolean };

type Props = {
  sections: HerdSection[];
  workspaceActions?: (sessionId: string, workspaceId: string) => ItemAction[];
  tabActions?: (sessionId: string, tabId: string) => ItemAction[];
  onDisconnect?: (hostId: string) => unknown;
  /** Saved hosts with no live session, offered when nothing is connected. */
  savedHosts: SavedHost[];
  error?: string | null;
  onConnect: (hostId: string) => void;
  onOpenPane?: (sessionId: string, paneId: string) => void;
  /** Opens the uncommitted changes in a finished agent's folder. */
  onReviewPane?: (sessionId: string, paneId: string) => void;
  /** Offered while at least one host can start a task. */
  onNewTask?: () => void;
};

const ROW_PAD = 9;
const GLYPH_TOP = 3;
const GLYPH_CENTER = ROW_PAD + GLYPH_TOP + GLYPH_SIZE / 2;

export function HerdScreen({ sections, savedHosts, error, onConnect, onOpenPane, onReviewPane, onNewTask, workspaceActions, tabActions, onDisconnect }: Props) {
  const { t } = useTranslation();
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const multiHost = sections.length > 1;
  const needYou = sections.reduce((sum, section) => sum + section.view.needYou, 0);
  const working = sections.reduce((sum, section) => sum + section.view.working, 0);
  const agentsShown = sections.some(section => section.view.workspaces.length > 0);

  return (
    <View style={s.screen}>
      <View style={s.appbar}>
        <Text style={s.title} accessibilityRole="header">Herd</Text>
        <View style={s.appbarEnd}>
          {sections.length === 1 && <ItemMenu label={sections[0].hostName} actions={onDisconnect ? [{ id: 'disconnect', label: t('rail.disconnectHost', { host: sections[0].hostName }), run: () => onDisconnect(sections[0].hostId) }] : []}><HostChip section={sections[0]} s={s} /></ItemMenu>}
          {multiHost && <Text style={s.hostName}>{sections.length} hosts</Text>}
          {onNewTask && (
            <Pressable onPress={onNewTask} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [s.newTask, pressed && s.rowPressed]}>
              <Text style={s.newTaskLabel}>New task</Text>
            </Pressable>
          )}
        </View>
      </View>
      {agentsShown && <Summary needYou={needYou} working={working} s={s} />}
      {error ? <Text style={[s.notice, s.noticeError, s.inset]}>{error}</Text> : null}
      <ScrollView contentContainerStyle={s.scroll}>
        {sections.length === 0 && <SavedHosts hosts={savedHosts} s={s} onConnect={onConnect} />}
        {sections.map(section => (
          <View key={section.sessionId}>
            {multiHost && <ItemMenu label={section.hostName} actions={onDisconnect ? [{ id: 'disconnect', label: t('rail.disconnectHost', { host: section.hostName }), run: () => onDisconnect(section.hostId) }] : []}><Text style={s.hostHeading}>{section.hostName}</Text></ItemMenu>}
            <SectionState section={section} s={s} onConnect={onConnect} />
            {section.view.workspaces.map(workspace => (
              <View key={workspace.workspaceId} style={s.workspace}>
                <ItemMenu label={workspace.label} actions={workspaceActions?.(section.sessionId, workspace.workspaceId) ?? []} actionsDisabled={section.state !== 'ready'}><Text style={s.workspaceLabel}>{workspace.label}</Text></ItemMenu>
                {workspace.tabs.map(tab => (
                  <TabChain
                    key={tab.tabId}
                    tab={tab}
                    actions={section.state === 'ready' ? tabActions?.(section.sessionId, tab.tabId) : undefined}
                    palette={palette}
                    s={s}
                    onOpenPane={onOpenPane ? paneId => onOpenPane(section.sessionId, paneId) : undefined}
                    onReviewPane={onReviewPane ? paneId => onReviewPane(section.sessionId, paneId) : undefined}
                  />
                ))}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function HostChip({ section, s }: { section: HerdSection; s: Styles }) {
  const live = section.state === 'ready' || section.state === 'ssh-only';
  return (
    <View style={s.host}>
      <View style={[s.hostDot, !live && s.hostDotOff]} />
      <Text style={s.hostName}>{section.hostName}</Text>
    </View>
  );
}

function Summary({ needYou, working, s }: { needYou: number; working: number; s: Styles }) {
  if (needYou === 0) {
    return <Text style={s.summary}>Nothing needs you. {working} working.</Text>;
  }
  return (
    <Text style={s.summary}>
      <Text style={s.summaryGold}>{needYou} need you</Text>, {working} working
    </Text>
  );
}

function SectionState({ section, s, onConnect }: {
  section: HerdSection;
  s: Styles;
  onConnect: (hostId: string) => void;
}) {
  const reconnect = () => onConnect(section.hostId);
  switch (section.state) {
    case 'ready':
      return section.view.workspaces.length === 0
        ? <Text style={s.notice}>No panes open. Start a task to put an agent to work here.</Text>
        : null;
    case 'connecting':
      return <Text style={s.notice}>Connecting to {section.hostName}</Text>;
    case 'reconnecting':
      return <Text style={s.notice}>Connection lost. Reconnecting to {section.hostName}</Text>;
    case 'ssh-only':
      return <Text style={s.notice}>Herdr is turned off for {section.hostName}, so there is no herd to show.</Text>;
    case 'offline':
      return <ActionRow label={`Reconnect ${section.hostName}`} s={s} onPress={reconnect} />;
    case 'error':
      return (
        <View>
          <Text style={[s.notice, s.noticeError]}>
            Could not connect to {section.hostName}{section.error ? `: ${section.error}` : '.'}
          </Text>
          <ActionRow label={`Retry ${section.hostName}`} s={s} onPress={reconnect} />
        </View>
      );
  }
}

function SavedHosts({ hosts, s, onConnect }: {
  hosts: SavedHost[];
  s: Styles;
  onConnect: (hostId: string) => void;
}) {
  if (hosts.length === 0) {
    return <Text style={s.notice}>No saved hosts. Add one in Hosts to see its agents here.</Text>;
  }
  return (
    <View>
      <Text style={s.notice}>Not connected. Pick a host to see its agents.</Text>
      {hosts.map(host => (
        <ActionRow
          key={host.hostId}
          label={host.connecting ? `Connecting to ${host.name}` : `Connect ${host.name}`}
          s={s}
          disabled={host.connecting}
          onPress={() => onConnect(host.hostId)}
        />
      ))}
    </View>
  );
}

function ActionRow({ label, s, onPress, disabled }: {
  label: string;
  s: Styles;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [s.action, pressed && s.rowPressed, disabled && s.actionDisabled]}
    >
      <Text style={s.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function TabChain({ tab, actions = [], palette, s, onOpenPane, onReviewPane }: {
  tab: HerdTab;
  actions?: ItemAction[];
  palette: Palette;
  s: Styles;
  onOpenPane?: (paneId: string) => void;
  onReviewPane?: (paneId: string) => void;
}) {
  const last = tab.panes.length - 1;
  return (
    <View style={s.tab}>
      <ItemMenu label={tab.label} actions={actions}><Text style={s.tabLabel}>{tab.label}</Text></ItemMenu>
      {tab.panes.map((pane, index) => (
        <PaneRow
          key={pane.paneId}
          pane={pane}
          linkAbove={index > 0}
          linkBelow={index < last}
          palette={palette}
          s={s}
          onPress={onOpenPane ? () => onOpenPane(pane.paneId) : undefined}
          onReview={onReviewPane && pane.status === 'done' ? () => onReviewPane(pane.paneId) : undefined}
        />
      ))}
    </View>
  );
}

function PaneRow({ pane, linkAbove, linkBelow, palette, s, onPress, onReview }: {
  pane: HerdPane;
  linkAbove: boolean;
  linkBelow: boolean;
  palette: Palette;
  s: Styles;
  onPress?: () => void;
  /** Offered once the agent is done, to read what it changed before replying. */
  onReview?: () => void;
}) {
  const needsYou = pane.status === 'blocked' || pane.status === 'done';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pane.name}, ${pane.status}${pane.detail ? `, ${pane.detail}` : ''}`}
    >
      <View style={s.gutter}>
        {linkAbove && <View style={[s.link, s.linkAbove]} />}
        {linkBelow && <View style={[s.link, s.linkBelow]} />}
        <View style={s.glyph}><StatusGlyph status={pane.status} palette={palette} /></View>
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowName} numberOfLines={1}>{pane.name}</Text>
        {pane.detail !== undefined && (
          <Text style={[s.rowDetail, needsYou && s.rowDetailGold]} numberOfLines={1}>
            {pane.detail}
          </Text>
        )}
      </View>
      {onReview && (
        <Pressable
          onPress={onReview}
          accessibilityRole="button"
          accessibilityLabel={`Review diff of ${pane.name}`}
          hitSlop={6}
          style={({ pressed }) => [s.review, pressed && s.rowPressed]}
        >
          <Text style={s.reviewLabel}>Review diff</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    appbar: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.lg,
    },
    title: { ...type.display, color: p.text },
    appbarEnd: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    newTask: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: 8, borderWidth: 1.5, borderColor: p.seam },
    newTaskLabel: { ...type.caption, fontFamily: type.bodyMedium.fontFamily, color: p.text },
    host: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    hostDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: p.text },
    hostDotOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.muted },
    hostName: { ...type.caption, color: p.muted },
    summary: { ...type.body, color: p.muted, paddingHorizontal: space.xl, paddingBottom: space.lg },
    summaryGold: { fontFamily: type.bodyBold.fontFamily, color: p.goldInk },
    scroll: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
    notice: { ...type.body, color: p.muted, paddingBottom: space.md },
    noticeError: { color: p.text },
    inset: { paddingHorizontal: space.xl },
    hostHeading: { ...type.title, color: p.text, paddingTop: space.md, paddingBottom: space.sm },
    action: {
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      marginBottom: space.sm,
    },
    actionDisabled: { opacity: 0.6 },
    actionLabel: { ...type.bodyBold, color: p.text },
    workspace: { marginBottom: space.sm },
    workspaceLabel: { ...type.caption, color: p.muted, paddingTop: space.xs, paddingBottom: space.sm },
    tab: { marginBottom: space.lg },
    tabLabel: {
      ...type.bodyMedium,
      color: p.text,
      paddingVertical: space.xs,
      paddingLeft: GLYPH_SIZE + 14,
    },
    row: { flexDirection: 'row', gap: 14, paddingVertical: ROW_PAD, borderRadius: 8 },
    rowPressed: { backgroundColor: p.surface },
    gutter: { width: GLYPH_SIZE, alignSelf: 'stretch' },
    glyph: { marginTop: GLYPH_TOP },
    link: { position: 'absolute', left: GLYPH_SIZE / 2 - 0.75, width: 1.5, backgroundColor: p.seam },
    linkAbove: { top: -ROW_PAD, height: GLYPH_CENTER },
    linkBelow: { top: GLYPH_CENTER - ROW_PAD, bottom: -ROW_PAD },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { ...type.body, color: p.text },
    rowDetail: { ...type.caption, color: p.muted, marginTop: 3 },
    rowDetailGold: { color: p.goldInk },
    review: {
      alignSelf: 'center',
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: p.seam,
    },
    reviewLabel: { ...type.caption, fontFamily: type.bodyMedium.fontFamily, color: p.text },
  });
}
