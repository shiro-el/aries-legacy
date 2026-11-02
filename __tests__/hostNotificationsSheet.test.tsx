import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

import { HostNotificationsSheet } from '../src/ui/hosts/HostNotificationsSheet';
import {
  enableRemoteNotifications,
  installNotificationPlugin,
  notificationPluginState,
  setNotificationPluginEnabled,
} from '../src/services/remoteNotifications';

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'dark',
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { notifyRelayUrl: 'https://notify.example' } } },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/services/remoteNotifications', () => ({
  disableRemoteNotifications: jest.fn(),
  enableRemoteNotifications: jest.fn(),
  installNotificationPlugin: jest.fn(),
  notificationPluginState: jest.fn(),
  remoteNotificationEncryption: jest.fn(async () => false),
  remoteNotificationStates: jest.fn(async () => []),
  setRemoteNotificationEncryption: jest.fn(),
  setNotificationPluginEnabled: jest.fn(),
  subscribeRemoteNotifications: jest.fn(() => jest.fn()),
  uninstallNotificationPlugin: jest.fn(),
}));

const host = { id: 'saved-host', name: 'Build machine' };
let root: ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(notificationPluginState).mockResolvedValue({
    installed: true, enabled: true, version: '0.1.7',
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

async function mount(connected = true) {
  await act(async () => {
    root = create(<HostNotificationsSheet host={host} connected={connected} onClose={jest.fn()} />);
  });
}

function button(label: string) {
  return root.root.findAllByType(Pressable).find(candidate =>
    candidate.findAllByType(Text).some(text => text.props.children === label),
  )!;
}

async function turnOnPush() {
  const action = button('Turn on push');
  expect(action.props.disabled).toBe(false);
  await act(async () => { await action.props.onPress(); });
}

test('opening alerts reads state without silently registering the phone', async () => {
  await mount();
  expect(notificationPluginState).toHaveBeenCalledWith(host.id);
  expect(enableRemoteNotifications).not.toHaveBeenCalled();
  await turnOnPush();
  expect(enableRemoteNotifications).toHaveBeenCalledWith(host.id, 'https://notify.example', false);
  expect(installNotificationPlugin).not.toHaveBeenCalled();
  expect(setNotificationPluginEnabled).not.toHaveBeenCalled();
});

test.each([
  { installed: false, enabled: false, version: null },
  { installed: true, enabled: true, version: '0.1.0', update_available: true },
])('turning on push installs a missing/outdated plugin before registration: %j', async state => {
  jest.mocked(notificationPluginState).mockResolvedValueOnce(state);
  let finishInstall!: () => void;
  jest.mocked(installNotificationPlugin).mockImplementationOnce(() => new Promise(resolve => {
    finishInstall = resolve;
  }));
  await mount();
  let setup!: Promise<void>;
  await act(async () => { setup = button('Turn on push').props.onPress(); });
  expect(installNotificationPlugin).toHaveBeenCalledWith(host.id, expect.any(Function));
  expect(button('Turn on push').props.disabled).toBe(true);
  expect(enableRemoteNotifications).not.toHaveBeenCalled();
  await act(async () => { finishInstall(); await setup; });
  expect(enableRemoteNotifications).toHaveBeenCalledWith(host.id, 'https://notify.example', false);
});

test('turning on push re-enables an installed but disabled plugin before registration', async () => {
  jest.mocked(notificationPluginState).mockResolvedValueOnce({
    installed: true, enabled: false, version: '0.1.7',
  });
  jest.mocked(setNotificationPluginEnabled).mockImplementationOnce(async () => {
    expect(enableRemoteNotifications).not.toHaveBeenCalled();
  });
  await mount();
  await turnOnPush();
  expect(setNotificationPluginEnabled).toHaveBeenCalledWith(host.id, true);
  expect(installNotificationPlugin).not.toHaveBeenCalled();
  expect(enableRemoteNotifications).toHaveBeenCalledWith(host.id, 'https://notify.example', false);
});

test('installation failure stays visible and prevents phone registration', async () => {
  jest.mocked(notificationPluginState).mockResolvedValueOnce({
    installed: false, enabled: false, version: null,
  });
  jest.mocked(installNotificationPlugin).mockRejectedValueOnce(new Error('Release unavailable'));
  await mount();
  await turnOnPush();
  expect(root.root.findAllByType(Text).some(text => text.props.children === 'Release unavailable')).toBe(true);
  expect(enableRemoteNotifications).not.toHaveBeenCalled();
});

test('push setup requires a connected host and a successful plugin check', async () => {
  await mount(false);
  expect(button('Turn on push').props.disabled).toBe(true);
  expect(notificationPluginState).not.toHaveBeenCalled();
  jest.mocked(notificationPluginState).mockRejectedValueOnce(new Error('Host unavailable'));
  await act(async () => {
    root.update(<HostNotificationsSheet host={host} connected onClose={jest.fn()} />);
  });
  expect(button('Turn on push').props.disabled).toBe(true);
  expect(enableRemoteNotifications).not.toHaveBeenCalled();
});
