import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CALL_URGENCIES, type CallUrgency, type HostCall } from '../../services/callLog';
import { formatCallTime, replyNote, URGENCY_LABEL } from './callView';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';
import type { HostCallLog } from './useHostCalls';

/** Where a call's pane lives now, or null once the pane is gone. */
export type CallPane = { sessionId: string; label: string };

type Props = {
  logs: Record<string, HostCallLog>;
  hostName: (hostId: string) => string;
  pane: (hostId: string, paneId: string) => CallPane | null;
  onOpenPane: (sessionId: string, paneId: string) => void;
};

type Filter = CallUrgency | 'all';
type Row = { hostId: string; call: HostCall };

/** Every call and approval the hosts kept, newest first. */
export function CallsScreen({ logs, hostName, pane, onOpenPane }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo<Row[]>(() => Object.entries(logs)
    .flatMap(([hostId, log]) => log.calls.map(call => ({ hostId, call })))
    .filter(row => filter === 'all' || row.call.urgency === filter)
    .sort((a, b) => b.call.createdAt - a.call.createdAt), [filter, logs]);

  const notices = Object.entries(logs).flatMap(([hostId, log]) => {
    if (log.status === 'unavailable') {
      return [`${hostName(hostId)}: no call log. Install or update its notification plugin in Hosts.`];
    }
    if (log.status === 'offline' && log.calls.length > 0) {
      return [`${hostName(hostId)} is not connected. These are the calls read before it disconnected.`];
    }
    return [];
  });
  const anyHost = Object.keys(logs).length > 0;

  return (
    <View style={s.screen}>
      <View style={s.appbar}>
        <Text style={s.title} accessibilityRole="header">Calls</Text>
      </View>
      <View style={s.filters} accessibilityRole="radiogroup">
        {(['all', ...CALL_URGENCIES] as Filter[]).map(value => {
          const on = value === filter;
          return (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && s.pressed]}
            >
              <Text style={[s.chipLabel, on && s.chipLabelOn]}>{value === 'all' ? 'All' : URGENCY_LABEL[value]}</Text>
            </Pressable>
          );
        })}
      </View>
      {notices.map(notice => <Text key={notice} style={[s.notice, s.inset]}>{notice}</Text>)}
      <FlatList
        data={rows}
        keyExtractor={row => `${row.hostId}:${row.call.callId}`}
        contentContainerStyle={s.scroll}
        ListEmptyComponent={
          <Text style={s.notice}>
            {!anyHost
              ? 'Connect a host to see its calls.'
              : filter === 'all'
                ? 'No calls yet. Agents call you with the call-human skill, and approvals that wait on you land here too.'
                : `No ${URGENCY_LABEL[filter].toLowerCase()} calls.`}
          </Text>
        }
        renderItem={({ item }) => (
          <CallRow
            row={item}
            hostName={hostName(item.hostId)}
            pane={pane(item.hostId, item.call.paneId)}
            s={s}
            onOpen={onOpenPane}
          />
        )}
      />
    </View>
  );
}

function CallRow({ row, hostName, pane, s, onOpen }: {
  row: Row;
  hostName: string;
  pane: CallPane | null;
  s: Styles;
  onOpen: (sessionId: string, paneId: string) => void;
}) {
  const { call } = row;
  const loud = call.urgency === 'emergency' || call.urgency === 'urgent';
  const title = call.title || (call.kind === 'approval' ? 'Waiting for approval' : 'Call');
  const where = pane ? `${hostName}, ${pane.label}` : `${hostName}, pane closed`;
  return (
    <Pressable
      onPress={pane ? () => onOpen(pane.sessionId, call.paneId) : undefined}
      disabled={!pane}
      accessibilityRole="button"
      accessibilityLabel={`${URGENCY_LABEL[call.urgency]}: ${title}. ${where}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={s.rowHead}>
        <Text style={[s.urgency, loud && s.urgencyLoud]}>{URGENCY_LABEL[call.urgency]}</Text>
        <Text style={s.time}>{formatCallTime(call.createdAt)}</Text>
      </View>
      <Text style={s.callTitle}>{title}</Text>
      {call.body ? <Text style={s.body} numberOfLines={4}>{call.body}</Text> : null}
      <Text style={s.meta} numberOfLines={1}>{where}</Text>
      {call.ineligibleReason ? (
        <Text style={s.meta}>Recorded without an alert: {call.ineligibleReason}</Text>
      ) : call.requestedUrgency && call.requestedUrgency !== call.urgency ? (
        <Text style={s.meta}>Asked for {call.requestedUrgency}</Text>
      ) : null}
      {call.reply ? (
        <Text style={s.reply}>
          Answered “{call.reply}”{replyNote(call.replyStatus)}
        </Text>
      ) : null}
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    appbar: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md },
    title: { ...type.display, color: p.text },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xl, paddingBottom: space.md },
    chip: { paddingVertical: 6, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    chipOn: { backgroundColor: p.text, borderColor: p.text },
    chipLabel: { ...type.caption, color: p.text },
    chipLabelOn: { color: p.bg, fontFamily: type.bodyBold.fontFamily },
    pressed: { backgroundColor: p.surface },
    inset: { paddingHorizontal: space.xl },
    notice: { ...type.body, color: p.muted, paddingBottom: space.md },
    scroll: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
    row: {
      paddingVertical: space.md,
      paddingHorizontal: space.xs,
      gap: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    urgency: { ...type.caption, color: p.muted },
    urgencyLoud: { color: p.goldInk, fontFamily: type.bodyBold.fontFamily },
    time: { ...type.caption, color: p.muted },
    callTitle: { ...type.bodyBold, color: p.text },
    body: { ...type.body, color: p.text },
    meta: { ...type.caption, color: p.muted },
    reply: { ...type.caption, color: p.text },
  });
}
