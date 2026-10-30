import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { alertRemoteNotification, prepareAlertChannels } from './alerts';
import { receiveRemoteNotification } from './remoteNotifications';
import { recordOperationalDiagnostic } from './operationalDiagnostics';

const TASK = 'aries-remote-notifications-v1';

// Required by index.js so Expo can run this without mounting the application.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
  if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
  // Visible fallback pushes already have an OS alert. Action handling belongs
  // to navigation/reply workflows, never to receipt/decryption a second time.
  try {
    if (!data || 'actionIdentifier' in data || data.notification !== null)
      return Notifications.BackgroundNotificationTaskResult.NoData;
    const payload: unknown = data.data.dataString ? JSON.parse(data.data.dataString) : data.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Notifications.BackgroundNotificationTaskResult.NoData;
    const opened = await receiveRemoteNotification(payload as Record<string, unknown>);
    if (!opened) return Notifications.BackgroundNotificationTaskResult.NoData;
    if (opened.event.urgency === 'record')
      return Notifications.BackgroundNotificationTaskResult.NewData;
    await prepareAlertChannels();
    await alertRemoteNotification(opened.event, opened.target);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  } catch {
    // Ciphertext, decrypted content, keys and provider payloads never enter logs.
    recordOperationalDiagnostic('warn', 'Notification', 'remote-notification-receive-failed', {});
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

if (Platform.OS === 'android') {
  Notifications.registerTaskAsync(TASK).catch(() => {
    recordOperationalDiagnostic('warn', 'Notification', 'remote-notification-task-registration-failed', {});
  });
}
