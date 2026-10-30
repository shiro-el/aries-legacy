import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui/text';
import { settledPromise } from '../lib/promises';
import { bestEffortCleanup } from '../services/backgroundOperations';
import {
  notificationRuntimes,
  subscribeNotificationRuntimeChanges,
  type NotificationRuntime,
} from '../services/notificationRuntimeRegistry';

type Urgency = 'emergency' | 'urgent' | 'check' | 'record';
interface CallRecord {
  call_id: string;
  kind: string;
  urgency: Urgency;
  created_at: number;
  pane_id: string;
  title?: string;
  body?: string;
  requested_urgency?: string;
  ineligible_reason?: string;
  reply?: string;
}
interface Props {
  hosts: { id: string; label: string }[];
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  showLauncher?: boolean;
  onConnectHost?: (hostId: string) => Promise<void>;
  onOpenPane: (hostId: string, paneId: string) => void | Promise<void>;
}
const urgencies: Urgency[] = ['emergency', 'urgent', 'check', 'record'];

/** One foreground consumer per app; history remains available when its sheet is closed. */
export function CallLogSurface({
  hosts,
  onOpenPane,
  visible: controlledVisible,
  onVisibleChange,
  showLauncher = true,
  onConnectHost,
}: Props) {
  const [localVisible, setLocalVisible] = useState(false);
  const visible = controlledVisible ?? localVisible;
  const setVisible = (value: boolean) => {
    setLocalVisible(value);
    onVisibleChange?.(value);
  };
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [filter, setFilter] = useState<Urgency | null>(null);
  const [records, setRecords] = useState<Record<string, CallRecord[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alerts, setAlerts] = useState<
    { hostId: string; record: CallRecord }[]
  >([]);
  useEffect(() => {
    const consumers = new Map<string, () => void>();
    const pending = new Map<NotificationRuntime, Promise<unknown>>();
    const command = (
      runtime: NotificationRuntime,
      operation: string,
      payload: string,
    ) => {
      const result = (pending.get(runtime) ?? Promise.resolve()).then(() =>
        runtime.notificationCommand(operation, payload),
      );
      pending.set(runtime, settledPromise(result));
      return result;
    };
    const attach = (hostId: string) => {
      consumers.get(hostId)?.();
      consumers.delete(hostId);
      const runtime = notificationRuntimes.get(hostId);
      if (!runtime || AppState.currentState !== 'active') return;
      let stopped = false;
      let running = false;
      let opened = false;
      let initialized = false;
      const seen = new Set<string>();
      const tick = async () => {
        if (stopped || running) return;
        running = true;
        try {
          const baseline = !opened;
          let value: string;
          if (baseline) {
            const discovery = JSON.parse(
              await command(runtime, 'discover', '{}'),
            ) as { paths: unknown };
            if (stopped) return;
            value = await command(
              runtime,
              'calls-open',
              JSON.stringify({ paths: discovery.paths }),
            );
            if (stopped) return;
            opened = true;
          } else value = await command(runtime, 'calls-read', '{}');
          if (stopped) return;
          const incoming = JSON.parse(value) as CallRecord[];
          const notify = initialized;
          initialized = true;
          const updates = new Map(
            incoming.map(record => [record.call_id, record]),
          );
          const fresh = [...updates.values()].filter(
            record => !seen.has(record.call_id),
          );
          incoming.forEach(record => seen.add(record.call_id));
          setRecords(previous => {
            const merged = new Map(
              (previous[hostId] ?? []).map(record => [record.call_id, record]),
            );
            incoming.forEach(record => merged.set(record.call_id, record));
            return {
              ...previous,
              [hostId]: [...merged.values()]
                .sort((a, b) => b.created_at - a.created_at)
                .slice(0, 10000),
            };
          });
          setErrors(previous => ({ ...previous, [hostId]: '' }));
          if (notify)
            setAlerts(previous =>
              [
                ...previous,
                ...fresh
                  .filter(
                    record =>
                      record.urgency !== 'record' &&
                      (record.kind === 'call' || record.kind === 'approval'),
                  )
                  .map(record => ({ hostId, record })),
              ].slice(-20),
            );
        } catch (error) {
          if (!stopped) {
            opened = false;
            setErrors(previous => ({ ...previous, [hostId]: String(error) }));
          }
        } finally {
          running = false;
        }
      };
      const timer = setInterval(() => {
        void tick();
      }, 1000);
      consumers.set(hostId, () => {
        stopped = true;
        clearInterval(timer);
        bestEffortCleanup(
          command(runtime, 'calls-stop', '{}'),
          'call-log-stop',
        );
      });
      void tick();
    };
    notificationRuntimes.forEach((_, hostId) => attach(hostId));
    const unsubscribe = subscribeNotificationRuntimeChanges(hostId =>
      attach(hostId),
    );
    const foreground = AppState.addEventListener('change', () => {
      consumers.forEach(stop => stop());
      consumers.clear();
      if (AppState.currentState === 'active')
        notificationRuntimes.forEach((_, hostId) => attach(hostId));
    });
    return () => {
      unsubscribe();
      foreground.remove();
      consumers.forEach(stop => stop());
    };
  }, []);
  const hostId = selectedHost ?? hosts[0]?.id;
  const open = async (targetHost: string, paneId: string) => {
    try {
      await onOpenPane(targetHost, paneId);
      setVisible(false);
      setAlerts([]);
    } catch (error) {
      setErrors(previous => ({ ...previous, [targetHost]: String(error) }));
    }
  };
  const action = (label: string, onPress: () => void, selected = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className="rounded-xl border border-border p-3"
    >
      <Text>{label}</Text>
    </Pressable>
  );
  return (
    <>
      {showLauncher ? action('Call log', () => setVisible(true)) : null}
      {alerts[0] ? (
        <View
          className="absolute inset-x-3 top-3 z-50 rounded-xl border border-border bg-background p-4"
          accessibilityLiveRegion="polite"
        >
          <Text>
            New call · {hosts.find(host => host.id === alerts[0].hostId)?.label}{' '}
            · {alerts[0].record.urgency}
          </Text>
          {errors[alerts[0].hostId] ? (
            <Text accessibilityRole="alert">{errors[alerts[0].hostId]}</Text>
          ) : null}
          <Text>{alerts[0].record.title}</Text>
          <Text>{alerts[0].record.body}</Text>
          {action('Open call pane', () => {
            void open(alerts[0].hostId, alerts[0].record.pane_id);
          })}
          {action('Dismiss call', () =>
            setAlerts(previous => previous.slice(1)),
          )}
        </View>
      ) : null}
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View className="flex-1 bg-background px-4 py-8">
          <Text className="text-xl font-bold">Call log</Text>
          {action('Close call log', () => setVisible(false))}
          <ScrollView horizontal className="grow-0">
            {hosts.map(host =>
              action(
                host.label,
                () => setSelectedHost(host.id),
                host.id === hostId,
              ),
            )}
          </ScrollView>
          <ScrollView horizontal className="grow-0">
            {action('All urgencies', () => setFilter(null), filter === null)}
            {urgencies.map(urgency =>
              action(urgency, () => setFilter(urgency), filter === urgency),
            )}
          </ScrollView>
          <ScrollView>
            {hostId && errors[hostId] ? (
              <Text accessibilityRole="alert">{errors[hostId]}</Text>
            ) : null}
            {!hostId || !notificationRuntimes.has(hostId) ? (
              <View>
                <Text>Connect to this host to read its call log.</Text>
                {hostId && onConnectHost
                  ? action('Connect host', () => {
                      void onConnectHost(hostId).catch(error =>
                        setErrors(previous => ({
                          ...previous,
                          [hostId]: String(error),
                        })),
                      );
                    })
                  : null}
              </View>
            ) : null}
            {hostId && !records[hostId]?.length ? (
              <Text>No calls yet.</Text>
            ) : null}
            {(hostId ? (records[hostId] ?? []) : [])
              .filter(record => !filter || record.urgency === filter)
              .map(record => (
                <Pressable
                  key={record.call_id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${record.title ?? record.call_id}`}
                  onPress={() => {
                    void open(hostId, record.pane_id);
                  }}
                  className="my-2 rounded-xl border border-border p-4"
                >
                  <Text>{record.title ?? record.kind}</Text>
                  <Text>{record.body}</Text>
                  <Text>
                    {record.kind} · {record.urgency} ·{' '}
                    {new Date(record.created_at * 1000).toLocaleString()} ·{' '}
                    {record.pane_id}
                  </Text>
                  {record.ineligible_reason ? (
                    <Text>
                      {record.ineligible_reason} · requested:{' '}
                      {record.requested_urgency}
                    </Text>
                  ) : null}
                  {record.reply ? <Text>Reply: {record.reply}</Text> : null}
                </Pressable>
              ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
