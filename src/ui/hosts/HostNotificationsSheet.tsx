import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  disableRemoteNotifications,
  enableRemoteNotifications,
  installNotificationPlugin,
  notificationPluginState,
  remoteNotificationEncryption,
  remoteNotificationStates,
  setRemoteNotificationEncryption,
  setNotificationPluginEnabled,
  subscribeRemoteNotifications,
  uninstallNotificationPlugin,
  type NotificationPluginInstallProgress,
  type NotificationPluginState,
  type RemoteNotificationState,
} from '../../services/remoteNotifications';
import { reportBackgroundFailure } from '../../services/backgroundOperations';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

type Props = {
  /** The host being set up; null hides the sheet. */
  host: { id: string; name: string } | null;
  connected: boolean;
  onClose: () => void;
};

const DEFAULT_RELAY = (Constants.expoConfig?.extra as { notifyRelayUrl?: string } | undefined)?.notifyRelayUrl ?? '';

const STAGES: Readonly<Record<NotificationPluginInstallProgress['stage'], string>> = {
  'checking-host': 'Checking the host',
  'checking-release': 'Finding the release',
  downloading: 'Downloading',
  enabling: 'Turning it on',
  verifying: 'Checking it works',
  complete: 'Installed',
};

type Plugin = { status: 'checking' } | { status: 'known'; state: NotificationPluginState } | { status: 'error'; message: string };

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/**
 * One host's push setup: the Herdr plugin that sends calls, and this phone's
 * registration with the relay that carries them.
 */
export function HostNotificationsSheet({ host, connected, onClose }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const hostId = host?.id ?? null;
  const [plugin, setPlugin] = useState<Plugin>({ status: 'checking' });
  const [push, setPush] = useState<RemoteNotificationState | undefined>(undefined);
  const [encrypted, setEncrypted] = useState(false);
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<NotificationPluginInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readPlugin = useCallback(async () => {
    if (!hostId || !connected) return;
    setPlugin({ status: 'checking' });
    try {
      const state = await notificationPluginState(hostId);
      setPlugin(state ? { status: 'known', state } : { status: 'error', message: 'The host is not connected.' });
    } catch (reason) {
      setPlugin({ status: 'error', message: message(reason) });
    }
  }, [connected, hostId]);

  useEffect(() => {
    if (!hostId) return;
    setError(null);
    setProgress(null);
    void readPlugin();
  }, [hostId, readPlugin]);

  useEffect(() => {
    if (!hostId) return;
    let current = true;
    const read = () => {
      reportBackgroundFailure(remoteNotificationStates().then(states => {
        const state = states.find(candidate => candidate.hostId === hostId);
        if (!current) return;
        setPush(state);
        if (state?.relayUrl) setRelay(state.relayUrl);
      }), 'host-alerts-push-read');
      reportBackgroundFailure(remoteNotificationEncryption(hostId).then(value => {
        if (current) setEncrypted(value);
      }), 'host-alerts-encryption-read');
    };
    read();
    const unsubscribe = subscribeRemoteNotifications(read);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [hostId]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  };

  const installed = plugin.status === 'known' && plugin.state.installed;
  const pluginLine = !connected
    ? 'Connect this host to check its plugin.'
    : plugin.status === 'checking'
      ? 'Checking'
      : plugin.status === 'error'
        ? `Could not check: ${plugin.message}`
        : !plugin.state.installed
          ? 'Not installed. Without it, agents cannot call you and calls are not kept.'
          : `Installed${plugin.state.version ? `, version ${plugin.state.version}` : ''}${plugin.state.enabled ? '' : ', turned off in Herdr'}`;

  const pushOn = push?.enabled === true;
  // An earlier registration the relay has not confirmed removing blocks a new
  // one; turning it off again retries the removal with the kept credentials.
  const stale = push !== undefined && !pushOn && (!push.relayRevoked || push.pendingHostRemoval);
  const pushLine = stale
    ? `An earlier registration${push.relayUrl ? ` with ${push.relayUrl.replace(/^https:\/\//, '')}` : ''} was not fully removed. Remove it before turning push on.`
    : pushOn
      ? `On, through ${push.relayUrl.replace(/^https:\/\//, '')}`
      : 'Off. Calls still show in the app while it is open.';

  return (
    <Modal visible={host !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <View style={s.bar}>
          <Text style={s.heading} accessibilityRole="header" numberOfLines={1}>
            Alerts from {host?.name ?? ''}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={s.done}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {error ? <Text style={s.error}>{error}</Text> : null}

          <Section title="Host plugin" s={s}>
            <Text style={s.body}>{pluginLine}</Text>
            {(busy === 'install' || busy === 'enable') && progress ? (
              <Text style={s.hint}>{STAGES[progress.stage]}</Text>
            ) : null}
            {connected && plugin.status === 'known' && (
              <View style={s.actions}>
                {(!installed || plugin.state.update_available) && (
                  <Action
                    label={installed ? 'Update plugin' : 'Install plugin'}
                    busy={busy === 'install'}
                    disabled={busy !== null}
                    solid
                    s={s}
                    onPress={() => run('install', async () => {
                      setProgress(null);
                      await installNotificationPlugin(hostId!, setProgress);
                      await readPlugin();
                    })}
                  />
                )}
                {installed && (
                  <Action
                    label="Remove plugin"
                    busy={busy === 'uninstall'}
                    disabled={busy !== null}
                    s={s}
                    onPress={() => run('uninstall', async () => {
                      await uninstallNotificationPlugin(hostId!);
                      await readPlugin();
                    })}
                  />
                )}
              </View>
            )}
            {connected && plugin.status === 'error' && (
              <View style={s.actions}>
                <Action label="Check again" disabled={busy !== null} s={s} onPress={() => { void readPlugin(); }} />
              </View>
            )}
          </Section>

          <Section title="Push to this phone" s={s}>
            <Text style={s.body}>{pushLine}</Text>
            {!pushOn && !stale && (
              <View style={s.field}>
                <Text style={s.hint}>Relay</Text>
                <TextInput
                  style={s.input}
                  value={relay}
                  onChangeText={setRelay}
                  placeholder="https://notify.example.com"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            )}
            <View style={s.actions}>
              {stale ? (
                <Action
                  label="Remove old registration"
                  busy={busy === 'cleanup'}
                  disabled={busy !== null}
                  solid
                  s={s}
                  onPress={() => run('cleanup', () => disableRemoteNotifications(hostId!))}
                />
              ) : pushOn ? (
                <Action
                  label="Turn off push"
                  busy={busy === 'disable'}
                  disabled={busy !== null}
                  s={s}
                  onPress={() => run('disable', () => disableRemoteNotifications(hostId!))}
                />
              ) : (
                <Action
                  label="Turn on push"
                  busy={busy === 'enable'}
                  disabled={busy !== null || !connected || plugin.status !== 'known' || !relay.trim()}
                  solid
                  s={s}
                  onPress={() => run('enable', async () => {
                    if (plugin.status !== 'known') return;
                    if (!plugin.state.installed || plugin.state.update_available) {
                      setProgress(null);
                      await installNotificationPlugin(hostId!, setProgress);
                      await readPlugin();
                    } else if (!plugin.state.enabled) {
                      await setNotificationPluginEnabled(hostId!, true);
                      await readPlugin();
                    }
                    await enableRemoteNotifications(hostId!, relay.trim(), encrypted);
                  })}
                />
              )}
            </View>
            {!pushOn && connected && !stale && (
              <Text style={s.hint}>Keep Aries open during setup. Turning on push installs or enables the host plugin, then verifies delivery to this phone.</Text>
            )}
            {!connected && !pushOn && <Text style={s.hint}>Connect this host to turn push on.</Text>}
          </Section>

          <Section title="Notification text" s={s}>
            <View style={s.toggle}>
              <View style={s.toggleText}>
                <Text style={s.body}>Encrypt end to end</Text>
                <Text style={s.hint}>
                  On, the relay and Google cannot read status notifications. Off, they show the tab and agent name. Calls and approvals are always encrypted.
                </Text>
              </View>
              <Switch
                value={encrypted}
                disabled={busy !== null || (pushOn && !connected)}
                onValueChange={value => run('encrypt', async () => {
                  await setRemoteNotificationEncryption(hostId!, value);
                  setEncrypted(value);
                })}
                trackColor={{ true: palette.text, false: palette.seam }}
                thumbColor={palette.bg}
              />
            </View>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ title, s, children }: { title: string; s: Styles; children: ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function Action({ label, busy, disabled, solid, s, onPress }: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  solid?: boolean;
  s: Styles;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [solid ? s.solid : s.quiet, pressed && (solid ? s.solidPressed : s.pressed), disabled && !busy && s.dim]}
    >
      {busy ? <ActivityIndicator size="small" color={solid ? s.solidLabel.color : s.quietLabel.color} /> : null}
      <Text style={solid ? s.solidLabel : s.quietLabel}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      paddingHorizontal: space.xl,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    heading: { ...type.bodyBold, color: p.text, flexShrink: 1 },
    done: { ...type.bodyBold, color: p.text },
    form: { padding: space.xl, gap: space.xxl, paddingBottom: 64 },
    error: { ...type.body, color: p.text, padding: space.md, borderRadius: radius.sm, backgroundColor: p.surface },
    section: { gap: space.sm },
    sectionTitle: { ...type.title, color: p.text },
    body: { ...type.body, color: p.text },
    hint: { ...type.caption, color: p.muted },
    field: { gap: space.xs },
    input: {
      ...type.body,
      color: p.text,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    quiet: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 10,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
    },
    quietLabel: { ...type.bodyMedium, color: p.text },
    solid: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 10,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      backgroundColor: p.text,
    },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
    pressed: { backgroundColor: p.surface },
    dim: { opacity: 0.45 },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    toggleText: { flex: 1, gap: 2 },
  });
}
