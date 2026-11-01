import Constants from 'expo-constants';

import { isUnknownRecord } from '../lib/unknown';
import type { DevicePreferences } from './devicePreferences';

export type DistributionChannel = 'app-store' | 'google-play' | 'github';

const DISTRIBUTION_CHANNELS: ReadonlySet<string> = new Set([
  'app-store',
  'google-play',
  'github',
]);

export function distributionChannelFromExtra(
  extra: unknown,
): DistributionChannel | null {
  if (!isUnknownRecord(extra)) return null;
  const rawChannel = extra.distributionChannel;
  return typeof rawChannel === 'string' && DISTRIBUTION_CHANNELS.has(rawChannel)
    ? (rawChannel as DistributionChannel)
    : null;
}

/** Developer options stay out of builds published to an app store. */
export function developerOptionsAvailableFor(
  channel: DistributionChannel | null,
): boolean {
  return channel !== 'app-store' && channel !== 'google-play';
}

export function developerOptionsAvailable(): boolean {
  return developerOptionsAvailableFor(
    distributionChannelFromExtra(Constants.expoConfig?.extra),
  );
}

/** Ignore stored debug settings in native store builds without deleting preferences. */
export function applyDeveloperOptionsPolicy(
  preferences: DevicePreferences,
  available: boolean,
): DevicePreferences {
  if (available) return preferences;
  return {
    ...preferences,
    developerOptionsEnabled: false,
    terminal: { ...preferences.terminal, visualHints: false },
  };
}
