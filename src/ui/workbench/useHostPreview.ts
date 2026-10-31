import { useEffect, useState } from 'react';
import type { HostRuntimeConnection, RuntimePreviewInfo } from 'react-native-whip-ssh';

import { bestEffortCleanup } from '../../services/backgroundOperations';

export type HostPreview =
  | { state: 'starting' }
  | { state: 'ready'; url: string }
  | { state: 'failed'; error: string };

/**
 * Starts a host-side preview (a tunnel, an HTML server or an SFTP stream) and
 * stops it when the key changes or the screen goes away.
 */
export function useHostPreview(
  native: HostRuntimeConnection | null,
  key: string | null,
  start: (native: HostRuntimeConnection) => Promise<RuntimePreviewInfo>,
): HostPreview | null {
  const [preview, setPreview] = useState<HostPreview | null>(null);

  useEffect(() => {
    if (!native || key === null) {
      setPreview(null);
      return;
    }
    let live = true;
    let started: string | null = null;
    setPreview({ state: 'starting' });
    start(native).then(
      info => {
        if (!live) {
          bestEffortCleanup(native.stopPreview(info.id), 'workbench-preview-stop');
          return;
        }
        started = info.id;
        setPreview({ state: 'ready', url: info.url });
      },
      (reason: unknown) => {
        if (live) setPreview({ state: 'failed', error: reason instanceof Error ? reason.message : String(reason) });
      },
    );
    return () => {
      live = false;
      if (started) bestEffortCleanup(native.stopPreview(started), 'workbench-preview-stop');
    };
    // `start` is rebuilt every render; the key names what it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, key]);

  return preview;
}
