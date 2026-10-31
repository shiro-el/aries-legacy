import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '../i18n';
import { useAgentNotifications } from '../hooks/useAgentNotifications';
import { useAppNavigation } from '../hooks/useAppNavigation';
import { useApplicationSecurity } from '../hooks/useApplicationSecurity';
import { useDevicePreferences } from '../hooks/useDevicePreferences';
import { useHostManagement } from '../hooks/useHostManagement';
import { useLiveHostTelemetry } from '../hooks/useLiveHostTelemetry';
import { useSessionRuntimeManager } from '../hooks/useSessionRuntimeManager';
import { useStartupStorage } from '../hooks/useStartupStorage';
import { useTerminalHistory } from '../hooks/useTerminalHistory';
import { useTerminalSessions } from '../hooks/useTerminalSessions';

/**
 * Composition root for the headless app core: storage, preferences, saved
 * hosts and live sessions. Screens read from what this returns.
 */
export function useAppRuntime() {
  const { t } = useTranslation();
  const startupStorage = useStartupStorage();
  const preferences = useDevicePreferences(startupStorage);
  const prefs = preferences.value;
  const preferencesLoaded = preferences.hydration.status !== 'loading';

  // Heavy hydration (hosts, keys, history) waits for the first frame.
  const [deferredHydrationReady, setDeferredHydrationReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDeferredHydrationReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const terminalHistory = useTerminalHistory({ startupStorage, deferredHydrationReady });

  // Host deletion must close the live session, which is created below.
  const closeHostRef = useRef<(hostId: string) => void>(() => undefined);
  const hosts = useHostManagement({
    startupStorage,
    deferredHydrationReady,
    t,
    onDeleteConnectedHost: hostId => closeHostRef.current(hostId),
  });

  const navigation = useAppNavigation({
    appReady: startupStorage.status !== 'loading',
    preferencesLoaded,
    preferredTab: 'herd',
    recordLastTab: preferences.recordLastTab,
    dismissTopOverlay: hosts.dismissTopOverlay,
  });

  const security = useApplicationSecurity({
    preferencesLoaded,
    biometricForKeys: prefs.biometricForKeys,
    biometricOnResume: prefs.biometricOnResume,
    onBiometricForKeysChange: enabled => preferences.setPreference('biometricForKeys', enabled),
    onBiometricOnResumeChange: enabled => preferences.setPreference('biometricOnResume', enabled),
    biometricUnavailableTitle: t('settings.biometricUnavailable'),
    biometricUnavailableMessage: error =>
      t('settings.biometricUnavailableCopy', { error: String(error) }),
  });

  const notifications = useAgentNotifications();
  const terminals = useTerminalSessions();
  const telemetry = useLiveHostTelemetry();

  const sessions = useSessionRuntimeManager({
    startupStorage,
    deferredHydrationReady,
    preferencesLoaded,
    terminalHistoryLoaded: terminalHistory.loaded,
    reopenTerminalOnLaunch: prefs.reopenTerminalOnLaunch,
    alertsEnabled: prefs.alertsEnabled,
    agentAlertLevel: prefs.agentAlertLevel,
    persistentAlertDurationSeconds: prefs.persistentAlertDurationSeconds,
    ttsEnabled: prefs.ttsEnabled,
    appAccessLocked: security.locked,
    hostsVisible: false,
    t,
    hosts,
    navigation,
    security,
    notifications,
    terminals,
    telemetry,
  });
  closeHostRef.current = hostId => {
    void sessions.closeHostById(hostId);
  };

  return { hosts, sessions, security, navigation, terminals, preferences: prefs };
}
