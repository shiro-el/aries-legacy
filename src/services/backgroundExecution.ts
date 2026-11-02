import { NativeModules, Platform } from 'react-native';
import { operationalErrorDetails, recordOperationalDiagnostic } from './operationalDiagnostics';

interface BackgroundWorkModule {
  beginBackgroundWork?: (timeoutMs: number) => number;
  endBackgroundWork: (id: number) => void;
}

/** Protect received work across awaits, never the idle interval between requests. */
export async function withBackgroundExecution<T>(
  work: () => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const native = Platform.OS === 'android'
    ? NativeModules?.HerdrBackground as BackgroundWorkModule | undefined
    : undefined;
  let id: number | undefined;
  try {
    // Also cover requests received in foreground that finish after backgrounding.
    id = native?.beginBackgroundWork?.(timeoutMs);
  } catch (error) {
    recordOperationalDiagnostic('warn', 'Application', 'background-work-lock-failed', operationalErrorDetails(error));
  }
  try {
    return await work();
  } finally {
    if (id !== undefined) {
      try { native?.endBackgroundWork(id); }
      catch (error) {
        recordOperationalDiagnostic('warn', 'Application', 'background-work-unlock-failed', operationalErrorDetails(error));
      }
    }
  }
}
