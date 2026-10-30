import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import { notificationOpen } from 'react-native-whip-ssh';

const mockData = new Map<string, string>();
const mockKeys = {
  private_key: 'private', public_key: 'public', key_id: 'key',
};
const mockRegistration = {
  hostId: 'saved-host', deviceId: 'device', keys: mockKeys,
  hostKey: 'pinned-host-key', session: '/tmp/herdr.sock', enabled: true,
  endToEndEncrypted: false,
};
let mockTask: (body: { data: Notifications.NotificationTaskPayload; error?: unknown }) => Promise<unknown>;
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((_name, callback) => { mockTask = callback; }),
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default', HIGH: 'high' },
  AndroidNotificationPriority: { DEFAULT: 'default', MAX: 'max' },
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  registerTaskAsync: jest.fn().mockResolvedValue(null),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('local-call'),
  dismissNotificationAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => ({ password: JSON.stringify([mockRegistration]) })),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-application', () => ({}));
jest.mock('../src/services/appStorage', () => ({ appStorage: {
  getItem: jest.fn(async (key: string) => mockData.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockData.set(key, value); }),
} }));
jest.mock('react-native-whip-ssh', () => ({ notificationOpen: jest.fn() }));
jest.mock('../src/services/speechPlayback', () => ({ getSpeechPlayback: jest.fn() }));
jest.mock('../src/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

function headless(): Notifications.NotificationTaskPayload {
  return { notification: null, data: { dataString: JSON.stringify({
    whip_notify: { header: { version: 2, device_id: 'device' }, ciphertext: 'encrypted' },
    title: 'forged title', urgency: 'check', hostId: 'forged-host', paneId: 'forged-pane',
  }) } };
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  mockData.clear();
  NativeModules.HerdrBackground = {
    armPersistentAlert: jest.fn().mockResolvedValue(undefined),
    dismissPersistentAlert: jest.fn().mockResolvedValue(undefined),
  };
  if (!mockTask) require('../src/services/remoteNotificationBackground');
  jest.mocked(notificationOpen).mockImplementation((_keys, _host, _device, _envelope, ledger) => {
    if (ledger !== '{}') throw new Error('replay');
    return JSON.stringify({
      event: { pane_id: 'w1:p1', workspace_id: 'w1', session: '/tmp/herdr.sock',
        status: 'blocked', kind: 'call', urgency: 'emergency', title: 'Production down', body: 'Need a decision' },
      ledger: { accepted: 99999 },
    });
  });
});

test('a headless emergency is authenticated, durably received, and rings through the persistent alarm path', async () => {
  require('../src/services/remoteNotificationBackground');
  expect(Notifications.registerTaskAsync).toHaveBeenCalledWith('aries-remote-notifications-v1');
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(async request => {
    expect(mockData.get('whip.notify.replays.v1.device')).toBe('{"accepted":99999}');
    expect(request).toMatchObject({
      content: { title: 'Production down', body: 'Need a decision', sound: 'default',
        data: { hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', agentAlertLevel: 'persistent' } },
      trigger: { channelId: 'agent-state-v3' },
    });
    return 'local-call';
  });
  await mockTask({ data: headless() });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(NativeModules.HerdrBackground.armPersistentAlert).toHaveBeenCalledWith('local-call', 'agent-state-v3', 30_000);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('agent-state-v3', expect.objectContaining({ bypassDnd: true }));
  expect(notificationOpen).toHaveBeenCalledWith(JSON.stringify(mockKeys), 'pinned-host-key', 'device', expect.any(String), '{}');
});

test.each([
  ['urgent', 'brief', 'agent-state-brief-v1'],
  ['check', 'regular', 'agent-state-regular-v1'],
  ['record', null, null],
] as const)('%s calls select their channel without starting the emergency alarm', async (urgency, level, channelId) => {
  jest.mocked(notificationOpen).mockReturnValueOnce(JSON.stringify({
    event: { pane_id: 'w1:p1', session: '/tmp/herdr.sock', kind: 'call', urgency,
      title: 'Decision needed', body: 'Which approach?' },
    ledger: { accepted: 99999 },
  }));
  await mockTask({ data: headless() });
  if (channelId) {
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ title: 'Decision needed', body: 'Which approach?',
        data: expect.objectContaining({ agentAlertLevel: level }) }),
      trigger: { channelId },
    }));
  } else {
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  }
  expect(NativeModules.HerdrBackground.armPersistentAlert).not.toHaveBeenCalled();
});

test('concurrent duplicate deliveries and a later cold task cannot produce a second local notification', async () => {
  await Promise.all([mockTask({ data: headless() }), mockTask({ data: headless() })]);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  jest.isolateModules(() => { require('../src/services/remoteNotificationBackground'); });
  await mockTask({ data: headless() });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test.each(['signature', 'session', 'storage'] as const)('a %s failure prevents local alerts and alarm playback', async failure => {
  if (failure === 'signature') jest.mocked(notificationOpen).mockImplementationOnce(() => { throw new Error('invalid signature'); });
  if (failure === 'session') jest.mocked(notificationOpen).mockReturnValueOnce(JSON.stringify({
    event: { session: '/different.sock', pane_id: 'w1:p1' }, ledger: { accepted: 99999 },
  }));
  if (failure === 'storage') jest.requireMock('../src/services/appStorage').appStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
  expect(await mockTask({ data: headless() })).toBe(Notifications.BackgroundNotificationTaskResult.Failed);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(NativeModules.HerdrBackground.armPersistentAlert).not.toHaveBeenCalled();
});

test('visible rollback pushes and action callbacks do not get decrypted or alerted again', async () => {
  await mockTask({ data: { ...headless(), notification: { title: 'Whip' } } as Notifications.NotificationTaskPayload });
  await mockTask({ data: { actionIdentifier: 'default' } as Notifications.NotificationTaskPayload });
  expect(notificationOpen).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('headless raw data objects use the same authenticated path as Android dataString', async () => {
  const received = headless();
  if ('actionIdentifier' in received) throw new Error('expected receipt');
  await mockTask({ data: { notification: null, data: JSON.parse(received.data.dataString!) } });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('an emergency task stays alive until the native alarm stops, including shake or its 30-second deadline', async () => {
  let stopAlarm!: () => void;
  NativeModules.HerdrBackground.armPersistentAlert.mockImplementationOnce(() => new Promise<void>(resolve => { stopAlarm = resolve; }));
  let completed = false;
  const reception = mockTask({ data: headless() }).then(() => { completed = true; });
  // Allow the authenticated receipt and notification scheduling to reach native.
  for (let i = 0; i < 30 && !stopAlarm; i++) await Promise.resolve();
  expect(stopAlarm).toBeDefined();
  expect(completed).toBe(false);
  stopAlarm();
  await reception;
  expect(completed).toBe(true);
});
