import { useEffect, useState } from 'react';
import { reportBackgroundFailure } from '../services/backgroundOperations';
import type { AgentCatalog } from 'react-native-whip-ssh';
import type { TerminalRenderTarget } from '../lib/terminalRenderer';

const CATALOG_TTL_MS = 5 * 60 * 1000;
type Refresh = { checkedAt: number; pending?: Promise<AgentCatalog | undefined> };
const refreshes = new WeakMap<object, Map<string, Refresh>>();

/** Native owns discovery and caching; late results cannot follow a pane switch. */
export function useAgentCatalog(
  target: TerminalRenderTarget | null,
  visible: boolean,
  paneContext = '',
) {
  const paneId = target?.session.paneId;
  const client = target?.client;
  const status = target?.session.status;
  const context = JSON.stringify([
    target?.key,
    paneId,
    paneContext,
    visible,
    status,
  ]);
  const [result, setResult] = useState<{
    context: string;
    catalog?: AgentCatalog;
    status: 'loading' | 'ready' | 'unavailable' | 'failed';
  }>({ context: '', status: 'unavailable' });
  useEffect(() => {
    let current = true;
    if (!visible || !paneId || !client || status !== 'connected') return;
    try {
      const native = client.native;
      const cached = native.cachedAgentCatalog(paneId);
      setResult({
        context,
        catalog: cached,
        status: cached ? 'ready' : 'loading',
      });
      let history = refreshes.get(native);
      if (!history) { history = new Map(); refreshes.set(native, history); }
      const key = JSON.stringify(cached?.key ?? [paneId, paneContext]);
      const cachedRefresh = history.get(key);
      const now = Date.now();
      if (cached && !cachedRefresh) {
        if (history.size >= 32) history.clear();
        history.set(key, { checkedAt: now });
        return;
      }
      if (cached && cachedRefresh && now - cachedRefresh.checkedAt < CATALOG_TTL_MS && !cachedRefresh.pending) return;
      let refresh = cachedRefresh;
      if (!refresh?.pending) {
        refresh = { checkedAt: now };
        if (history.size >= 32) history.clear();
        history.set(key, refresh);
        const entry = refresh;
        refresh.pending = native.refreshAgentCatalog(paneId).then(catalog => {
          if (catalog) history.set(JSON.stringify(catalog.key), { checkedAt: Date.now() });
          return catalog;
        }).finally(() => { entry.pending = undefined; });
      }
      reportBackgroundFailure(
        refresh.pending
          .then(catalog => {
            if (current)
              setResult({
                context,
                catalog,
                status: catalog ? 'ready' : 'unavailable',
              });
          })
          .catch(error => {
            if (current)
              setResult(previous => ({
                ...previous,
                context,
                status: 'failed',
              }));
            throw error;
          }),
        'agent-catalog-refresh',
      );
    } catch {
      setResult({ context, status: 'unavailable' });
    }
    return () => {
      current = false;
    };
  }, [client, context, paneContext, paneId, status, visible]);
  return result.context === context
    ? result
    : { catalog: undefined, status: 'unavailable' as const };
}
