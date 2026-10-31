import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { alertRemoteNotification, prepareAlertChannels } from './alerts';
import { receiveRemoteNotification } from './remoteNotifications';
import { operationalErrorDetails, recordOperationalDiagnostic } from './operationalDiagnostics';
import { handleNotificationChoice } from './notificationChoices';

const TASK = 'aries-remote-notifications-v1';

/**
 * Background tasks get the raw native response, where a local alert's data
 * is only `content.dataString`. Expo parses it for listeners but not here.
 */
function withContentData(response: Notifications.NotificationResponse): Notifications.NotificationResponse {
  const request = response.notification.request;
  const raw = (request.content as { dataString?: unknown }).dataString;
  if (request.content.data || typeof raw !== 'string') return response;
  const data = JSON.parse(raw) as Record<string, unknown>;
  return { ...response, notification: { ...response.notification,
    request: { ...request, content: { ...request.content, data } } } };
}

// Required by index.js so Expo can run this without mounting the application.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
  if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
  // Which step failed; messages come from app code, never from the payload.
  let stage = 'choice';
  try {
    if (data && 'actionIdentifier' in data) {
      return await handleNotificationChoice(withContentData(data))
        ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
    }
    // Visible fallback pushes already have an OS alert. Android drops the
    // null `notification` key when it serializes a data-only push.
    if (!data || data.notification != null)
      return Notifications.BackgroundNotificationTaskResult.NoData;
    stage = 'parse';
    const payload: unknown = data.data.dataString ? JSON.parse(data.data.dataString) : data.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Notifications.BackgroundNotificationTaskResult.NoData;
    stage = 'open';
    const opened = await receiveRemoteNotification(payload as Record<string, unknown>);
    if (!opened) return Notifications.BackgroundNotificationTaskResult.NoData;
    if (opened.event.urgency === 'record')
      return Notifications.BackgroundNotificationTaskResult.NewData;
    stage = 'alert';
    await prepareAlertChannels();
    await alertRemoteNotification(opened.event, opened.target);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  } catch (failure) {
    // Ciphertext, decrypted content, keys and provider payloads never enter logs.
    recordOperationalDiagnostic('warn', 'Notification', 'remote-notification-receive-failed', {
      stage,
      ...operationalErrorDetails(failure),
    });
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

if (Platform.OS === 'android') {
  Notifications.registerTaskAsync(TASK).catch(() => {
    recordOperationalDiagnostic('warn', 'Notification', 'remote-notification-task-registration-failed', {});
  });
}
