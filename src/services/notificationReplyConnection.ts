import { createHostRuntime, createSecureId } from 'react-native-whip-ssh';
import type { ConnectionProfile } from '../types';
import { normalizePrivateKey } from '../lib/privateKey';
import { DEFAULT_HERDR_COMMAND } from '../lib/hostProfiles';
import { loadConnectionProfile, loadHostProfiles, loadJumpHostConnectionProfiles } from './hostProfiles';
import { loadKnownHosts } from './knownHosts';
import { loadDevicePreferences } from './devicePreferences';
import { notificationRuntimes, type NotificationRuntime } from './notificationRuntimeRegistry';

/** A cold task gets its own short-lived native runtime; it never takes ownership
 * of, disconnects, or replaces a UI runtime or its event listener. */
export async function withNotificationReplyConnection<T>(hostId: string, work: (runtime: NotificationRuntime) => Promise<T>): Promise<T> {
  const active = notificationRuntimes.get(hostId);
  if (active) return work(active);
  const hosts = await loadHostProfiles();
  const host = hosts.find(h => h.id === hostId && h.herdrEnabled !== false);
  if (!host) throw new Error('Saved host unavailable');
  const preferences = await loadDevicePreferences();
  const jumpProfiles = await loadJumpHostConnectionProfiles(hosts, host);
  if (preferences.biometricForKeys && [host, ...jumpProfiles].some(p => p.authMode === 'key'))
    throw new Error('Open the app to authenticate the SSH key');
  const profile = await loadConnectionProfile(host);
  if ([profile, ...jumpProfiles].some(p => !p.secret)) throw new Error('Saved SSH credential unavailable');
  if ((await loadKnownHosts()).status !== 'loaded') throw new Error('Known hosts unavailable');
  const ssh = (p: ConnectionProfile) => ({
    host: p.host.trim(), port: Number(p.port), username: p.username.trim(), authMode: p.authMode,
    secret: p.authMode === 'key' ? normalizePrivateKey(p.secret) : p.secret,
    passphrase: p.passphrase || undefined, forwardAgent: p.forwardAgent,
  });
  const runtime = createHostRuntime({
    runtimeId: createSecureId('notification-reply'), ssh: ssh(profile), jumpHosts: jumpProfiles.map(ssh),
    herdrEnabled: true, sessionName: profile.sessionName.trim(),
    herdrCommand: profile.herdrCommand.trim() || DEFAULT_HERDR_COMMAND,
    socketPath: profile.herdrSocketPath?.trim() || undefined,
  }, () => {});
  try {
    await runtime.connect();
    return await work(runtime);
  } finally {
    await runtime.disconnect();
  }
}
