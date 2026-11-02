import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

interface LeasePulseModule {
  setNotificationLeasePulseInterval?: (intervalMs: number) => void;
}

/** Android pauses RN timers with the activity, even when our SSH service lives.
 * Native only requests a pulse: JS must execute and certify delivery readiness.
 * Handler callbacks neither wake a sleeping device nor renew leases themselves.
 */
export function observeNotificationLeasePulses(
  tick: () => void,
  intervalMs: number,
): () => void {
  const native = Platform.OS === 'android'
    ? NativeModules.HerdrBackground as LeasePulseModule | undefined
    : undefined;
  if (native?.setNotificationLeasePulseInterval) {
    const subscription = DeviceEventEmitter.addListener('WhipNotificationLeasePulse', tick);
    native.setNotificationLeasePulseInterval(intervalMs);
    return () => {
      subscription.remove();
      native.setNotificationLeasePulseInterval?.(0);
    };
  }
  // iOS and older native builds retain the foreground-only RN timer behavior.
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
