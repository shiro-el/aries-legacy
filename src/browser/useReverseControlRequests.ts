import { useEffect } from 'react';
import { subscribeReverseControlEvents } from 'react-native-whip-ssh';

import { bestEffortCleanup } from '../services/backgroundOperations';
import { withBackgroundExecution } from '../services/backgroundExecution';
import { supportsBrowserControl } from './native';
import { browserRegistry, type BrowserRuntime } from './registry';

/**
 * Answers Reverse Control requests (browser.* and device.*) for the connected
 * hosts. Upstream did this inside its BrowserSurface; Aries has no such
 * surface, so without this hook every tool call times out.
 */
export function useReverseControlRequests(runtimes: readonly BrowserRuntime[]): void {
  useEffect(() => {
    if (!supportsBrowserControl()) return;
    return subscribeReverseControlEvents((event, runtime) => {
      // Transport never logs page arguments or action results.
      void withBackgroundExecution(() => browserRegistry.event(event, runtime).catch(() => {
        runtime.reverseControlReply(
          event.session.sessionId,
          event.requestId,
          JSON.stringify({ ok: false, error: { code: 'browser_unavailable', message: 'Browser session unavailable' } }),
        );
      }));
    });
  }, []);

  useEffect(() => {
    if (!supportsBrowserControl()) return;
    let cancelled = false;
    bestEffortCleanup(
      browserRegistry.loadArchive().then(() => {
        if (cancelled) return;
        browserRegistry.registerRuntimes(runtimes);
        const live = new Set(runtimes.map(runtime => runtime.runtimeId));
        for (const owned of browserRegistry.entries.values()) {
          if (!live.has(owned.identity.runtimeId))
            bestEffortCleanup(browserRegistry.closeHost(owned.identity.runtimeId), 'browser-host-close');
        }
        for (const runtime of runtimes) browserRegistry.reconcile(runtime);
      }),
      'browser-runtime-restore',
    );
    return () => {
      cancelled = true;
    };
  }, [runtimes]);
}
