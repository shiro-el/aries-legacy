import { settledPromise } from '../lib/promises';
import * as Notifications from 'expo-notifications';
import { recordOperationalDiagnostic } from './operationalDiagnostics';

// Serialize category creation + scheduling with pruning, including overlapping
// background tasks. Never remove a category between its creation and use.
let operations: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = settledPromise(result);
  return result;
}

async function prune(): Promise<void> {
  try {
    const [categories, presented] = await Promise.all([
      Notifications.getNotificationCategoriesAsync(),
      Notifications.getPresentedNotificationsAsync(),
    ]);
    const active = new Set(presented.map(notification => notification.request.content.categoryIdentifier));
    await Promise.all(categories.filter(category => category.identifier.startsWith('whip-call-') && !active.has(category.identifier))
      .map(category => Notifications.deleteNotificationCategoryAsync(category.identifier)));
  } catch {
    recordOperationalDiagnostic('warn', 'Notification', 'call-category-cleanup-failed', {});
  }
}

export function pruneCallNotificationCategories(): Promise<void> {
  return serial(prune);
}

export function scheduleRemoteNotification(
  request: Notifications.NotificationRequestInput,
  choices?: string[],
): Promise<string> {
  return serial(async () => {
    await prune();
    const category = request.content.categoryIdentifier;
    if (category && choices) {
      await Notifications.setNotificationCategoryAsync(category, choices.map((buttonTitle, index) => ({
        identifier: `whip-choice-${index}`, buttonTitle, options: { opensAppToForeground: false },
      })));
    }
    try {
      return await Notifications.scheduleNotificationAsync(request);
    } catch (error) {
      await prune();
      throw error;
    }
  });
}
