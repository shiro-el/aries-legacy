import * as Notifications from 'expo-notifications';
import { dismissPersistentAgentAlertForNotification } from './backgroundMonitoring';
import { replyToRemoteCall } from './remoteNotifications';

/** Only local, authenticated call alerts carry a category and a call reference.
 * Host-side lookup validates every reference and supplies the actual choice. */
export async function handleNotificationChoice(response: Notifications.NotificationResponse): Promise<boolean> {
  const match = /^whip-choice-([0-2])$/.exec(response.actionIdentifier);
  if (!match) return false;
  const request = response.notification.request;
  const data = request.content.data;
  if ((request.trigger && 'type' in request.trigger && request.trigger.type === 'push') || data?.whip_notify || !data
    || typeof data.hostId !== 'string' || typeof data.paneId !== 'string'
    || typeof data.remoteDeviceId !== 'string' || typeof data.callId !== 'string'
    || request.content.categoryIdentifier !== `whip-call-${data.callId}`) return false;
  let body = 'Failed to deliver. Open the app to check before replying again.';
  try {
    const { withNotificationReplyConnection } = require('./notificationReplyConnection') as typeof import('./notificationReplyConnection');
    const result = await withNotificationReplyConnection(data.hostId, runtime => replyToRemoteCall(
      data.hostId as string, data.remoteDeviceId as string, runtime, data.callId as string, data.paneId as string, Number(match[1]),
    ));
    if (result.reply_status === 'delivered' && result.reply) body = `Delivered: ${result.reply}`;
    else if (result.reply_status !== 'failed') body = 'Delivery unconfirmed. Open the app to check before replying again.';
  } catch {
    // Do not log host content, credentials or selected text. Never auto-resend.
  }
  await dismissPersistentAgentAlertForNotification(request.identifier);
  await Notifications.scheduleNotificationAsync({
    identifier: request.identifier,
    content: { title: request.content.title || 'Aries', body, data: {
      hostId: data.hostId, paneId: data.paneId, remoteDeviceId: data.remoteDeviceId,
      agentAlertLevel: 'regular',
    } },
    trigger: { channelId: 'agent-state-regular-v1' },
  });
  return true;
}
