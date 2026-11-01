import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import type { LiveHostConnectionStatus } from '../../liveHostSessions';
import type { HostProfile } from '../../types';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { PhoneAlerts, type PhoneAlertPreferences, type SetPreference } from './PhoneAlerts';
import { ShizukuSection } from '../shizuku/ShizukuSection';
import { VoiceInputSetting } from './VoiceInputSetting';

export type HostRow = {
  host: HostProfile;
  /** Live session state, absent when the host is not connected. */
  status?: LiveHostConnectionStatus;
  connecting: boolean;
};

type Props = {
  rows: HostRow[];
  loaded: boolean;
  error?: string | null;
  onAdd: () => void;
  onEdit: (host: HostProfile) => void;
  onConnect: (host: HostProfile) => void;
  onDisconnect: (host: HostProfile) => void;
  onNotifications: (host: HostProfile) => void;
  alerts: PhoneAlertPreferences;
  onAlertsChange: SetPreference;
  /** Bumped when the composer needs a Groq key; scrolls to and opens its editor. */
  voiceKeyRequest?: number;
};

export function HostsScreen({
  rows, loaded, error, onAdd, onEdit, onConnect, onDisconnect, onNotifications, alerts, onAlertsChange,
  voiceKeyRequest = 0,
}: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (voiceKeyRequest > 0 && loaded) scroll.current?.scrollToEnd({ animated: true });
  }, [loaded, voiceKeyRequest]);

  return (
    <View style={s.screen}>
      <View style={s.appbar}>
        <Text style={s.title} accessibilityRole="header">Hosts</Text>
        <Pressable onPress={onAdd} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [s.add, pressed && s.pressed]}>
          <Text style={s.addLabel}>Add host</Text>
        </Pressable>
      </View>
      {error ? <Text style={[s.notice, s.inset]}>{error}</Text> : null}
      <ScrollView ref={scroll} contentContainerStyle={s.scroll}>
        {loaded && rows.length === 0 && (
          <View style={s.empty}>
            <Text style={s.notice}>
              Add the machine where Herdr runs. Aries connects over SSH and shows every agent it finds.
            </Text>
            <Pressable onPress={onAdd} accessibilityRole="button" style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}>
              <Text style={s.primaryLabel}>Add host</Text>
            </Pressable>
          </View>
        )}
        {rows.map(row => (
          <HostItem
            key={row.host.id}
            row={row}
            s={s}
            onEdit={() => onEdit(row.host)}
            onConnect={() => onConnect(row.host)}
            onDisconnect={() => onDisconnect(row.host)}
            onNotifications={() => onNotifications(row.host)}
          />
        ))}
        {loaded && <PhoneAlerts value={alerts} onChange={onAlertsChange} />}
        {loaded && <ShizukuSection />}
        {loaded && <VoiceInputSetting editRequest={voiceKeyRequest} />}
      </ScrollView>
    </View>
  );
}

function statusText(row: HostRow): string {
  if (row.connecting) return 'Connecting';
  switch (row.status) {
    case 'connected':
    case 'ready':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'error':
      return 'Failed';
    case 'disconnected':
    case undefined:
      return 'Not connected';
  }
}

function HostItem({ row, s, onEdit, onConnect, onDisconnect, onNotifications }: {
  row: HostRow;
  s: Styles;
  onEdit: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onNotifications: () => void;
}) {
  const { host } = row;
  const live = row.status !== undefined && row.status !== 'disconnected' && row.status !== 'error';
  const online = row.status === 'connected' || row.status === 'ready';
  const address = `${host.username ? `${host.username}@` : ''}${host.host}${host.port && host.port !== '22' ? `:${host.port}` : ''}`;
  return (
    <View style={s.item}>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`${host.name || host.host}, ${statusText(row)}. Edit`}
        style={({ pressed }) => [s.itemMain, pressed && s.pressed]}
      >
        <View style={[s.dot, online ? s.dotOn : s.dotOff]} />
        <View style={s.itemText}>
          <Text style={s.name} numberOfLines={1}>{host.name || host.host}</Text>
          <Text style={s.meta} numberOfLines={1}>{address}</Text>
          <Text style={s.meta}>{statusText(row)}{host.herdrEnabled === false ? ', SSH only' : ''}</Text>
        </View>
      </Pressable>
      {host.herdrEnabled !== false && (
        <Pressable
          onPress={onNotifications}
          accessibilityRole="button"
          accessibilityLabel={`${host.name || host.host} notifications`}
          style={({ pressed }) => [s.action, pressed && s.pressed]}
        >
          <Text style={s.actionLabel}>Alerts</Text>
        </Pressable>
      )}
      <Pressable
        onPress={live ? onDisconnect : onConnect}
        disabled={row.connecting}
        accessibilityRole="button"
        style={({ pressed }) => [s.action, pressed && s.pressed, row.connecting && s.disabled]}
      >
        <Text style={s.actionLabel}>{live ? 'Disconnect' : 'Connect'}</Text>
      </Pressable>
    </View>
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
    add: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: 8 },
    addLabel: { ...type.bodyBold, color: p.text },
    pressed: { backgroundColor: p.surface },
    inset: { paddingHorizontal: space.xl },
    notice: { ...type.body, color: p.muted, paddingBottom: space.md },
    scroll: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
    empty: { gap: space.sm },
    primary: {
      alignSelf: 'flex-start',
      paddingVertical: space.md,
      paddingHorizontal: space.xl,
      borderRadius: radius.sm,
      backgroundColor: p.text,
    },
    primaryPressed: { opacity: 0.85 },
    primaryLabel: { ...type.bodyBold, color: p.bg },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    itemMain: { flex: 1, flexDirection: 'row', gap: 14, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    dotOn: { backgroundColor: p.text },
    dotOff: { borderWidth: 1.5, borderColor: p.muted },
    itemText: { flex: 1, minWidth: 0, gap: 2 },
    name: { ...type.bodyBold, color: p.text },
    meta: { ...type.caption, color: p.muted },
    action: {
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
    },
    actionLabel: { ...type.bodyMedium, color: p.text },
    disabled: { opacity: 0.5 },
  });
}
