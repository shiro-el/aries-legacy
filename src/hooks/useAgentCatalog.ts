import { useEffect, useState } from 'react';
import { reportBackgroundFailure } from '../services/backgroundOperations';
import type { AgentCatalog } from 'react-native-whip-ssh';
import type { TerminalRenderTarget } from '../lib/terminalRenderer';

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
      reportBackgroundFailure(
        native
          .refreshAgentCatalog(paneId)
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
  }, [client, context, paneId, status, visible]);
  return result.context === context
    ? result
    : { catalog: undefined, status: 'unavailable' as const };
}
