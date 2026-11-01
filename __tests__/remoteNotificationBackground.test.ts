import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import { createHostRuntime } from 'react-native-whip-ssh';
import { bindNotificationRuntime, unbindNotificationRuntime } from '../src/services/notificationRuntimeRegistry';

// Authentication, replay receipts, session checks and call replies run in the
// Rust notification manager and alert coordinator (see their Rust tests). This
// suite scripts both and checks what the background task does with the result.
const mockData = new Map<string, string>();
type MockEvent = {
  status?: string; title?: string; body?: string; kind?: string; urgency?: string;
  options?: string[]; callId?: string;
};
let mockEvent: MockEvent;
let mockOpenFailure: Error | null;
const mockReceipts = new Set<string>();
const mockReply = jest.fn();
const mockManager = {
  notificationTarget: jest.fn((data: string, notificationId: string) => ({
    target: async () => {
      if (mockOpenFailure) throw mockOpenFailure;
      // The Rust ledger refuses a second receipt of the same envelope.
      if (mockReceipts.has(data)) throw new Error('Notification authentication failed');
      mockReceipts.add(data);
      return {
        notificationId, hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device',
        event: { status: 'blocked', options: [], ...mockEvent },
      };
    },
  })),
  replyToCall: mockReply,
  attachRuntime: jest.fn(),
  detachRuntime: jest.fn(),
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
  getPermissionsAsync: jest.fn(),
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
jest.mock('../packages/react-native-whip-ssh/src/generated/whip_ssh-ffi', () => ({
  __esModule: true,
  default: () => ({}),
}));
jest.mock('react-native-whip-ssh', () => {
  const generated = jest.requireActual('../packages/react-native-whip-ssh/src/generated/whip_ssh');
  const { LocalAlertAction, LocalAlertDelivery, LocalAlertEffectAdmission, LocalAlertAction_Tags, LocalAlertOutcome_Tags } = generated;
  // Schedules each alert, then keeps an Android emergency ringing.
  const pending = new Map<string, { tag: string; inner: { request: { delivery: string; android: boolean; persistentTimeoutMs: number } } }>();
  let effects = 0;
  const coordinator = {
    setRuntime: () => [],
    alert: (request: unknown) => {
      const id = `effect-${++effects}`;
      const action = new LocalAlertAction.Schedule({ request });
      pending.set(id, action);
      return [{ id, action }];
    },
    beginEffect: () => LocalAlertEffectAdmission.Run,
    completeEffect: (id: string, outcome: { tag: string; inner: { notificationId: string } }) => {
      const action = pending.get(id);
      pending.delete(id);
      const request = action && action.tag === LocalAlertAction_Tags.Schedule ? action.inner.request : undefined;
      if (!request || outcome.tag !== LocalAlertOutcome_Tags.Scheduled
        || request.delivery !== LocalAlertDelivery.Persistent || !request.android) return [];
      return [{ id: `effect-${++effects}`, action: new LocalAlertAction.ArmPersistent({
        notificationId: outcome.inner.notificationId, timeoutMs: request.persistentTimeoutMs,
      }) }];
    },
  };
  const ssh = require('./mockWhipSsh').createMockWhipSshModule();
  // Real generated alert enums; every other native entry point stays mocked.
  return {
    ...generated,
    ...ssh,
    NotificationManager: jest.fn(() => mockManager),
    LocalAlertCoordinator: jest.fn(() => coordinator),
    notificationLeasePulseIntervalMs: () => 3000,
  };
});
const mockSavedHost = {
  id: 'saved-host', name: 'Workstation', host: 'host.example', port: '22', username: 'dev',
  authMode: 'password', herdrCommand: 'herdr', herdrSocketPath: '/tmp/herdr.sock', sessionName: '',
  createdAt: '2026-10-30', updatedAt: '2026-10-30',
};
// Saved hosts and credentials are read through Rust credential transactions.
jest.mock('../src/services/hostProfiles', () => ({
  loadHostProfiles: jest.fn(async () => [mockSavedHost]),
  loadConnectionProfile: jest.fn(async (host: object) => ({ ...host, secret: 'saved-password', passphrase: '' })),
  loadJumpHostConnectionProfiles: jest.fn(async () => []),
}));
jest.mock('../src/services/speechPlayback', () => ({ getSpeechPlayback: jest.fn() }));
jest.mock('../src/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

let pushes = 0;
function headless(): Notifications.NotificationTaskPayload {
  // Each delivery is a distinct envelope unless a test reuses one.
  return { notification: null, data: { dataString: JSON.stringify({
    whip_notify: { header: { version: 2, device_id: 'device', event_id: `event-${++pushes}` }, ciphertext: 'encrypted' },
    title: 'forged title', urgency: 'check', hostId: 'forged-host', paneId: 'forged-pane',
  }) } };
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  mockData.clear();
  mockReceipts.clear();
  mockReply.mockReset();
  mockOpenFailure = null;
  mockEvent = { kind: 'call', urgency: 'emergency', title: 'Production down', body: 'Need a decision' };
  NativeModules.HerdrBackground = {
    armPersistentAlert: jest.fn().mockResolvedValue(undefined),
    dismissPersistentAlert: jest.fn().mockResolvedValue(undefined),
    dismissPersistentAlertForNotification: jest.fn().mockResolvedValue(undefined),
  };
  if (!mockTask) require('../src/services/remoteNotificationBackground');
});

test('a headless emergency is authenticated in Rust and rings through the persistent alarm path', async () => {
  require('../src/services/remoteNotificationBackground');
  expect(Notifications.registerTaskAsync).toHaveBeenCalledWith('aries-remote-notifications-v1');
  await mockTask({ data: headless() });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ title: 'Production down', body: 'Need a decision', sound: 'default',
      data: { hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', agentAlertLevel: 'persistent' } }),
    trigger: { channelId: 'agent-state-v3' },
  }));
  expect(NativeModules.HerdrBackground.armPersistentAlert).toHaveBeenCalledWith('local-call', 'agent-state-v3', 30_000);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('agent-state-v3', expect.objectContaining({ bypassDnd: true }));
  expect(mockManager.notificationTarget).toHaveBeenCalledWith(expect.stringContaining('"whip_notify"'), '');
});

test.each([
  ['urgent', 'brief', 'agent-state-brief-v1'],
  ['check', 'regular', 'agent-state-regular-v1'],
  ['record', null, null],
] as const)('%s calls select their channel without starting the emergency alarm', async (urgency, level, channelId) => {
  mockEvent = { kind: 'call', urgency, title: 'Decision needed', body: 'Which approach?' };
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
  const push = headless();
  await Promise.all([mockTask({ data: push }), mockTask({ data: push })]);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  const appTask = mockTask;
  try {
    jest.isolateModules(() => { require('../src/services/remoteNotificationBackground'); });
    await mockTask({ data: push });
  } finally {
    mockTask = appTask;
  }
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('an authentication failure prevents local alerts and alarm playback', async () => {
  mockOpenFailure = new Error('Notification session mismatch');
  expect(await mockTask({ data: headless() })).toBe(Notifications.BackgroundNotificationTaskResult.Failed);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(NativeModules.HerdrBackground.armPersistentAlert).not.toHaveBeenCalled();
});

test('visible rollback pushes and action callbacks do not get decrypted or alerted again', async () => {
  await mockTask({ data: { ...headless(), notification: { title: 'Whip' } } as Notifications.NotificationTaskPayload });
  await mockTask({ data: { actionIdentifier: 'default' } as Notifications.NotificationTaskPayload });
  expect(mockManager.notificationTarget).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('headless raw data objects use the same authenticated path as Android dataString', async () => {
  const received = headless();
  if ('actionIdentifier' in received) throw new Error('expected receipt');
  await mockTask({ data: { notification: null, data: JSON.parse(received.data.dataString!) } });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('Android data-only pushes arrive without a notification key and still alert', async () => {
  const received: Record<string, unknown> = { ...headless() };
  delete received.notification;
  await mockTask({ data: received as Notifications.NotificationTaskPayload });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test.each([1, 2, 3])('%i call choices become background actions on the authenticated local alert', async count => {
  const options = ['Ship it', 'Revise', 'Wait'].slice(0, count);
  mockEvent = { kind: 'call', urgency: 'check', callId: 'call-123', title: 'Choose', options };
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
  mockEvent = { kind: 'approval', urgency: 'urgent', callId: 'approval-1', options: ['Allow'] };
  await mockTask({ data: headless() });
  expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled();
  const content = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0].content;
  expect(content.categoryIdentifier).toBeUndefined();
  expect(content.data?.callId).toBeUndefined();
});

test.each([false, true])('a cold background choice connects, replies through Rust and updates the same alert (cleanup fails: %s)', async cleanupFails => {
  mockReply.mockResolvedValueOnce({ reply: 'Revise', replyStatus: 'delivered', unconfirmed: false });
  const ssh = { disconnect: jest.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); }), requestHerdrApi: jest.fn(async () => ({
    type: 'session_snapshot', snapshot: { panes: [] },
  })) };
  require('./mockWhipSsh').getMockWhipSshControl().connectWithPassword.mockResolvedValueOnce(ssh);
  jest.mocked(Notifications.getNotificationCategoriesAsync).mockResolvedValueOnce([
    { identifier: 'whip-call-call-123', actions: [] },
  ]);
  const action = { actionIdentifier: 'whip-choice-1', notification: { date: 1, request: {
    identifier: 'local-call', trigger: null, content: { title: 'Choose', body: 'Which plan?',
      // Android hands background tasks the local alert's data only as JSON text.
      categoryIdentifier: 'whip-call-call-123', dataString: JSON.stringify({
        hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', callId: 'call-123', agentAlertLevel: 'persistent',
      }) },
  } } } as unknown as Notifications.NotificationTaskPayload;
  expect(await mockTask({ data: action })).toBe(Notifications.BackgroundNotificationTaskResult.NewData);
  expect(createHostRuntime).toHaveBeenCalledWith(expect.objectContaining({
    ssh: expect.objectContaining({ host: 'host.example', secret: 'saved-password' }),
  }), expect.any(Function));
  const runtimeId = jest.mocked(createHostRuntime).mock.calls[0][0].runtimeId;
  expect(mockReply).toHaveBeenCalledWith('saved-host', 'device', runtimeId, 'call-123', 'w1:p1', 1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    identifier: 'local-call', content: expect.objectContaining({ title: 'Choose', body: 'Delivered: Revise',
      data: expect.objectContaining({ hostId: 'saved-host', paneId: 'w1:p1' }) }),
  }));
  expect(ssh.disconnect).toHaveBeenCalled();
  expect(NativeModules.HerdrBackground.dismissPersistentAlertForNotification).toHaveBeenCalledWith('local-call');
  expect(NativeModules.HerdrBackground.dismissPersistentAlert).not.toHaveBeenCalled();
  expect(Notifications.deleteNotificationCategoryAsync).toHaveBeenCalledWith('whip-call-call-123');
  expect(mockManager.notificationTarget).not.toHaveBeenCalled();
});

test.each([
  ['identity', 'Failed to deliver'],
  ['lost', 'Delivery unconfirmed'],
  ['unknown', 'Delivery unconfirmed'],
  ['failed', 'Failed to deliver'],
] as const)('a %s reply outcome updates the same alert with no remaining actions or automatic resend', async (outcome, body) => {
  if (outcome === 'identity') mockReply.mockRejectedValueOnce(new Error('The notification host or Herdr session changed; register this device again'));
  else mockReply.mockResolvedValueOnce(outcome === 'lost'
    ? { unconfirmed: true }
    : { reply: 'Wait', replyStatus: outcome, unconfirmed: false });
  const runtime = { runtimeId: 'bound-runtime', runtimeIncarnation: 1 };
  bindNotificationRuntime('saved-host', runtime);
  try {
    const action = { actionIdentifier: 'whip-choice-0', notification: { date: 1, request: {
      identifier: 'local-call', trigger: null, content: { title: 'Choose', categoryIdentifier: 'whip-call-call-123',
        data: { hostId: 'saved-host', paneId: 'w1:p1', remoteDeviceId: 'device', callId: 'call-123' } },
    } } } as unknown as Notifications.NotificationResponse;
    expect(await mockTask({ data: action })).toBe(Notifications.BackgroundNotificationTaskResult.NewData);
    const update = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0];
    expect(update.identifier).toBe('local-call');
    expect(update.content.body).toContain(body);
    expect(update.content.categoryIdentifier).toBeUndefined();
    expect(update.content.data?.callId).toBeUndefined();
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(mockReply).toHaveBeenCalledWith('saved-host', 'device', 'bound-runtime', 'call-123', 'w1:p1', 0);
    expect(createHostRuntime).not.toHaveBeenCalled();
  } finally { unbindNotificationRuntime('saved-host', runtime); }
});

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
