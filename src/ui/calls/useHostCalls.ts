import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { appStorage } from '../../services/appStorage';
import { bestEffortCleanup, reportBackgroundFailure } from '../../services/backgroundOperations';
import {
  interrupts,
  mergeCalls,
  openCallLog,
  readCallLog,
  stopCallLog,
  type HostCall,
} from '../../services/callLog';
import {
  notificationRuntimes,
  subscribeNotificationRuntimeChanges,
  type NotificationRuntime,
} from '../../services/notificationRuntimeRegistry';

export type HostCallLog = {
  /** `offline` keeps the calls last read while the host is not attached. */
  status: 'loading' | 'ready' | 'unavailable' | 'offline';
  calls: HostCall[];
};

export type ArrivedCall = { hostId: string; call: HostCall };

const SEEN_KEY = 'aries.calls.seenAt.v1';
const READ_MS = 1000;
const RETRY_MS = 15_000;

type Follower = { runtime: NotificationRuntime; stop: () => void };

/**
 * Follows the call log of every attached host while the app is in the
 * foreground. History already in the log arrives silently; only calls that
 * appear while following are announced.
 */
export function useHostCalls() {
  const [logs, setLogs] = useState<Record<string, HostCallLog>>({});
  const [arrived, setArrived] = useState<ArrivedCall | null>(null);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [runtimes, setRuntimes] = useState(() => new Map(notificationRuntimes));
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const followers = useRef(new Map<string, Follower>());

  useEffect(() => subscribeNotificationRuntimeChanges(() => setRuntimes(new Map(notificationRuntimes))), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let current = true;
    appStorage.getItem(SEEN_KEY)
      .then(value => {
        if (current) setSeenAt(value ? Number(value) || 0 : 0);
      })
      .catch(() => {
        if (current) setSeenAt(0);
      });
    return () => {
      current = false;
    };
  }, []);

  const update = useCallback((hostId: string, change: (log: HostCallLog) => HostCallLog) => {
    setLogs(all => ({ ...all, [hostId]: change(all[hostId] ?? { status: 'loading', calls: [] }) }));
  }, []);

  useEffect(() => {
    const wanted = foreground ? runtimes : new Map<string, NotificationRuntime>();
    for (const [hostId, follower] of followers.current) {
      if (wanted.get(hostId) === follower.runtime) continue;
      follower.stop();
      followers.current.delete(hostId);
      update(hostId, log => ({ ...log, status: 'offline' }));
    }
    for (const [hostId, runtime] of wanted) {
      if (followers.current.has(hostId)) continue;
      followers.current.set(hostId, { runtime, stop: follow(hostId, runtime, update, setArrived) });
    }
  }, [foreground, runtimes, update]);

  useEffect(() => () => {
    for (const follower of followers.current.values()) follower.stop();
    followers.current.clear();
  }, []);

  const markSeen = useCallback(() => {
    const now = Date.now();
    setSeenAt(now);
    reportBackgroundFailure(appStorage.setItem(SEEN_KEY, String(now)), 'calls-seen-save');
  }, []);

  const unseen = seenAt === null
    ? 0
    : Object.values(logs).reduce((sum, log) => sum + log.calls.filter(call => call.createdAt > seenAt).length, 0);

  const dismissArrived = useCallback(() => setArrived(null), []);

  return { logs, arrived, dismissArrived, unseen, markSeen };
}

function follow(
  hostId: string,
  runtime: NotificationRuntime,
  update: (hostId: string, change: (log: HostCallLog) => HostCallLog) => void,
  announce: (call: ArrivedCall) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (work: () => Promise<void>, ms: number) => {
    if (!stopped) timer = setTimeout(() => { void work(); }, ms);
  };

  const open = async () => {
    try {
      const calls = await openCallLog(runtime);
      if (stopped) return;
      update(hostId, log => ({ status: 'ready', calls: mergeCalls(log.calls, calls) }));
      later(read, READ_MS);
    } catch {
      // No plugin, an older plugin or a dropped connection: try again later.
      update(hostId, log => ({ ...log, status: 'unavailable' }));
      later(open, RETRY_MS);
    }
  };

  const read = async () => {
    try {
      const calls = await readCallLog(runtime);
      if (stopped) return;
      if (calls.length > 0) {
        update(hostId, log => ({ status: 'ready', calls: mergeCalls(log.calls, calls) }));
        // A reply or failure is a revision of a call already shown, not news.
        const fresh = calls.filter(call => interrupts(call) && !call.reply && !call.replyStatus);
        const newest = fresh[fresh.length - 1];
        if (newest) announce({ hostId, call: newest });
      }
      later(read, READ_MS);
    } catch {
      // The stream dropped; reopening replays the snapshot without announcing.
      later(open, READ_MS);
    }
  };

  void open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    bestEffortCleanup(stopCallLog(runtime), 'calls-stop');
  };
}
