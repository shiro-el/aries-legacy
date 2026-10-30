import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import { notificationOpen, createHostRuntime } from 'react-native-whip-ssh';
import { bindNotificationRuntime, unbindNotificationRuntime } from '../src/services/notificationRuntimeRegistry';

const mockData = new Map<string, string>();
const mockKeys = {
  private_key: 'private', public_key: 'public', key_id: 'key',
};
const mockRegistration = {
  hostId: 'saved-host', deviceId: 'device', keys: mockKeys,
  hostKey: 'pinned-host-key', session: '/tmp/herdr.sock', enabled: true,
  endToEndEncrypted: false,
  hostIdentity: 'pinned-identity',
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
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(null),
  getNotificationCategoriesAsync: jest.fn().mockResolvedValue([]),
  getPresentedNotificationsAsync: jest.fn().mockResolvedValue([]),
  deleteNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
  dismissNotificationAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }) => ({ password: service === 'dev.whip.notification-keys.v1'
    ? JSON.stringify([mockRegistration]) : JSON.stringify({ secret: 'saved-password' }) })),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-application', () => ({}));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { document: { uri: '/documents' } } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('../src/services/appStorage', () => ({ appStorage: {
  getItem: jest.fn(async (key: string) => mockData.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockData.set(key, value); }),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockData.get(key) ?? null])),
} }));
jest.mock('react-native-whip-ssh', () => ({
  ...require('./mockWhipSsh').createMockWhipSshModule(), notificationOpen: jest.fn(),
}));
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
    dismissPersistentAlertForNotification: jest.fn().mockResolvedValue(undefined),
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

test.each([1, 2, 3])('%i call choices become background actions on the authenticated local alert', async count => {
  const options = ['Ship it', 'Revise', 'Wait'].slice(0, count);
  jest.mocked(notificationOpen).mockReturnValueOnce(JSON.stringify({
    event: { pane_id: 'w1:p1', session: '/tmp/herdr.sock', kind: 'call', urgency: 'check',
      call_id: 'call-123', title: 'Choose', options }, ledger: { accepted: 99999 },
  }));
  await mockTask({ data: headless() });
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith('whip-call-call-123',
    options.map((buttonTitle, index) => ({ identifier: `whip-choice-${index}`, buttonTitle,
      options: { opensAppToForeground: false } })));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ categoryIdentifier: 'whip-call-call-123',
      data: expect.objectContaining({ callId: 'call-123', hostId: 'saved-host', paneId: 'w1:p1' }) }),
  }));
});

test('new receipts reclaim dismissed call categories and retain categories still in use', async () => {
  jest.mocked(Notifications.getNotificationCategoriesAsync).mockResolvedValueOnce([
    { identifier: 'whip-call-dismissed', actions: [] },
    { identifier: 'whip-call-active', actions: [] },
    { identifier: 'another-feature', actions: [] },
  ]);
  jest.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValueOnce([
    { request: { content: { categoryIdentifier: 'whip-call-active' } } } as Notifications.Notification,
  ]);
  await mockTask({ data: headless() });
  expect(Notifications.deleteNotificationCategoryAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.deleteNotificationCategoryAsync).toHaveBeenCalledWith('whip-call-dismissed');
});

test('approval alerts never offer reply buttons even if their payload contains choices', async () => {
  jest.mocked(notificationOpen).mockReturnValueOnce(JSON.stringify({
    event: { pane_id: 'w1:p1', session: '/tmp/herdr.sock', kind: 'approval', urgency: 'urgent',
      call_id: 'approval-1', options: ['Allow'] }, ledger: { accepted: 99999 },
  }));
  await mockTask({ data: headless() });
  expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled();
  const content = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0].content;
  expect(content.categoryIdentifier).toBeUndefined();
  expect(content.data?.callId).toBeUndefined();
});

test.each([false, true])('a cold background choice connects, verifies, submits and updates the same alert (cleanup fails: %s)', async cleanupFails => {
  mockData.set('herdr.hosts.v2', JSON.stringify([{
    id: 'saved-host', name: 'Workstation', host: 'host.example', port: '22', username: 'dev',
    authMode: 'password', herdrCommand: 'herdr', herdrSocketPath: '/tmp/herdr.sock', sessionName: '',
    createdAt: '2026-10-30', updatedAt: '2026-10-30',
  }]));
  mockData.set('herdr.credentials.backup-migration', '1');
  const command = jest.fn(async (operation: string, payload: string) => {
    if (operation === 'discover') return JSON.stringify({ paths: { binary: '/bin/notify', config: '/config', state: '/state' },
      identity: { public_key: 'pinned-host-key', host_id: 'pinned-identity' }, session: '/tmp/herdr.sock' });
    expect(operation).toBe('reply');
    expect(JSON.parse(payload)).toEqual({ paths: { binary: '/bin/notify', config: '/config', state: '/state' },
      call_id: 'call-123', option_index: 1, pane_id: 'w1:p1' });
    return JSON.stringify({ call_id: 'call-123', pane_id: 'w1:p1', reply: 'Revise', reply_status: 'delivered' });
  });
  const ssh = { notificationCommand: command, disconnect: jest.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); }), requestHerdrApi: jest.fn(async () => ({
    type: 'session_snapshot', snapshot: { panes: [] },
  })) };
  require('./mockWhipSsh').getMockWhipSshControl().connectWithPassword.mockResolvedValueOnce(ssh);
  jest.mocked(Notifications.getNotificationCategoriesAsync).mockResolvedValueOnce([
    { identifier: 'whip-call-call-123', actions: [] },
  ]);
  const action = { actionIdentifier: 'whip-choice-1', notification: { date: 1, request: {
    identifier: 'local-call', trigger: null, content: { title: 'Choose', body: 'Which plan?',
      categoryIdentifier: 'whip-call-call-123', data: {
        hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', callId: 'call-123', agentAlertLevel: 'persistent',
      } },
  } } } as unknown as Notifications.NotificationTaskPayload;
  expect(await mockTask({ data: action })).toBe(Notifications.BackgroundNotificationTaskResult.NewData);
  expect(createHostRuntime).toHaveBeenCalledWith(expect.objectContaining({
    ssh: expect.objectContaining({ host: 'host.example', secret: 'saved-password' }),
  }), expect.any(Function));
  expect(command).toHaveBeenCalledWith('reply', expect.any(String));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    identifier: 'local-call', content: expect.objectContaining({ title: 'Choose', body: 'Delivered: Revise',
      data: expect.objectContaining({ hostId: 'saved-host', paneId: 'w1:p1' }) }),
  }));
  expect(ssh.disconnect).toHaveBeenCalled();
  expect(NativeModules.HerdrBackground.dismissPersistentAlertForNotification).toHaveBeenCalledWith('local-call');
  expect(NativeModules.HerdrBackground.dismissPersistentAlert).not.toHaveBeenCalled();
  expect(Notifications.deleteNotificationCategoryAsync).toHaveBeenCalledWith('whip-call-call-123');
  expect(notificationOpen).not.toHaveBeenCalled();
});

test.each(['identity', 'session', 'offline', 'unknown', 'failed'])(
  '%s reply failure updates the same alert with no remaining actions or automatic resend', async failure => {
    const runtime = { notificationCommand: jest.fn(async (operation: string) => {
      if (operation === 'discover') return JSON.stringify({ paths: { binary: '/bin/notify', config: '/config', state: '/state' },
        identity: { public_key: failure === 'identity' ? 'different-key' : 'pinned-host-key', host_id: 'pinned-identity' },
        session: failure === 'session' ? '/other.sock' : '/tmp/herdr.sock' });
      if (failure === 'offline') throw new Error('SSH unavailable');
      return JSON.stringify({ reply: 'Wait', reply_status: failure });
    }) };
    bindNotificationRuntime('saved-host', runtime);
    try {
      const action = { actionIdentifier: 'whip-choice-0', notification: { date: 1, request: {
        identifier: 'local-call', trigger: null, content: { title: 'Choose', categoryIdentifier: 'whip-call-call-123',
          data: { hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', callId: 'call-123' } },
      } } } as unknown as Notifications.NotificationResponse;
      expect(await mockTask({ data: action })).toBe(Notifications.BackgroundNotificationTaskResult.NewData);
      const update = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0];
      expect(update.identifier).toBe('local-call');
      expect(update.content.body).toContain(failure === 'unknown' || failure === 'offline' ? 'Delivery unconfirmed' : 'Failed to deliver');
      expect(update.content.categoryIdentifier).toBeUndefined();
      expect(update.content.data?.callId).toBeUndefined();
      expect(runtime.notificationCommand.mock.calls.filter(([operation]) => operation === 'reply')).toHaveLength(
        failure === 'identity' || failure === 'session' ? 0 : 1);
      expect(createHostRuntime).not.toHaveBeenCalled();
      expect(notificationOpen).not.toHaveBeenCalled();
    } finally { unbindNotificationRuntime('saved-host', runtime); }
  },
);

test.each(['push', 'wrong-category', 'no-call', 'default'])('a %s action cannot submit a reply', async invalid => {
  const action = { actionIdentifier: invalid === 'default' ? 'default' : 'whip-choice-0', notification: { date: 1, request: {
    identifier: 'local-call', trigger: invalid === 'push' ? { type: 'push' } : null,
    content: { categoryIdentifier: invalid === 'wrong-category' ? 'other-call' : 'whip-call-call-123',
      data: { hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', ...(invalid === 'no-call' ? {} : { callId: 'call-123' }) } },
  } } } as unknown as Notifications.NotificationResponse;
  expect(await mockTask({ data: action })).toBe(Notifications.BackgroundNotificationTaskResult.NoData);
  expect(createHostRuntime).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
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
