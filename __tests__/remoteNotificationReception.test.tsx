import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { useAgentNotifications } from '../src/hooks/useAgentNotifications';
import { alertAgent } from '../src/services/alerts';
import { remoteNotificationTarget } from '../src/services/remoteNotifications';
let mockReceive: (response: Notifications.NotificationResponse) => void;
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  addNotificationResponseReceivedListener: jest.fn(
    (listener: typeof mockReceive) => {
      mockReceive = listener;
      return { remove: jest.fn() };
    },
  ),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponse: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
}));
jest.mock('../src/services/alerts', () => ({
  prepareAlerts: jest.fn().mockResolvedValue(undefined),
  dismissAgentAlerts: jest.fn().mockResolvedValue(undefined),
  alertAgent: jest.fn(),
}));
jest.mock('../src/services/remoteNotifications', () => ({
  isRemoteNotification: (data?: Record<string, unknown>) =>
    Boolean(data?.whip_notify),
  remoteNotificationTarget: jest.fn().mockResolvedValue({
    hostId: 'authenticated-host',
    paneId: 'w1:p2',
    notificationId: 'push-1',
    remoteDeviceId: 'authenticated-device',
  }),
}));
let notifications: ReturnType<typeof useAgentNotifications>;
function Harness() {
  notifications = useAgentNotifications();
  return null;
}
function response(version = 1): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'default',
    notification: {
      date: 1,
      request: {
        identifier: 'push-1',
        trigger: null,
        content: {
          title: 'Whip',
          body: 'An agent has an update',
          sound: null,
          subtitle: null,
          categoryIdentifier: null,
          threadIdentifier: null,
          data: {
            whip_notify: { header: { version }, ciphertext: 'encrypted' },
            hostId: 'forged-host',
            paneId: 'forged-pane',
          },
        },
      },
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  (
    Notifications.getLastNotificationResponseAsync as jest.Mock
  ).mockResolvedValue(null);
});
test.each([['running', 1], ['terminated', 1], ['running', 2], ['terminated', 2]] as const)(
  'authenticates a %s-app v%s notification tap without scheduling another alert',
  async (initial, version) => {
    if (initial === 'terminated')
      (
        Notifications.getLastNotificationResponseAsync as jest.Mock
      ).mockResolvedValue(response(version));
    let root!: renderer.ReactTestRenderer;
    await act(async () => {
      root = renderer.create(<Harness />);
    });
    if (initial === 'running')
      await act(async () => {
        mockReceive(response(version));
      });
    expect(remoteNotificationTarget).toHaveBeenCalledWith(
      expect.objectContaining({ whip_notify: expect.anything() }),
      'push-1',
    );
    expect(notifications.response?.notification.request.content.data).toEqual({
      hostId: 'authenticated-host',
      paneId: 'w1:p2',
      remoteDeviceId: 'authenticated-device',
    });
    expect(alertAgent).not.toHaveBeenCalled();
    await act(() => root.unmount());
  },
);

test('rejects remote plaintext that imitates a trusted local notification', async () => {
  const forged = response();
  forged.notification.request.trigger = { type: 'push' };
  forged.notification.request.content.data = {
    hostId: 'forged-host',
    paneId: 'forged-pane',
  };
  (remoteNotificationTarget as jest.Mock).mockResolvedValueOnce(null);
  (
    Notifications.getLastNotificationResponseAsync as jest.Mock
  ).mockResolvedValue(forged);
  let root!: renderer.ReactTestRenderer;
  await act(async () => {
    root = renderer.create(<Harness />);
  });
  expect(notifications.response).toBeNull();
  expect(alertAgent).not.toHaveBeenCalled();
  await act(() => root.unmount());
});
