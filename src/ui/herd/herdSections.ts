import type { SessionPresentation } from '../../liveHostSessions';
import { buildHerdView, type HerdView } from './herdView';

export type HerdSectionState =
  | 'ready'
  | 'connecting'
  | 'reconnecting'
  | 'offline'
  | 'error'
  /** Connected over plain SSH; the host has Herdr turned off. */
  | 'ssh-only';

export type HerdSection = {
  sessionId: string;
  hostId: string;
  hostName: string;
  state: HerdSectionState;
  error?: string;
  view: HerdView;
};

const EMPTY_VIEW: HerdView = { workspaces: [], needYou: 0, working: 0 };

export function herdSection(session: SessionPresentation): HerdSection {
  const base = { sessionId: session.id, hostId: session.hostId, hostName: session.host.name };
  const snapshot = session.hostState?.snapshot;
  switch (session.connectionStatus) {
    case 'connected':
    case 'ready':
      if (session.host.herdrEnabled === false) return { ...base, state: 'ssh-only', view: EMPTY_VIEW };
      return snapshot
        ? { ...base, state: 'ready', view: buildHerdView(snapshot) }
        : { ...base, state: 'connecting', view: EMPTY_VIEW };
    case 'reconnecting':
      // Keep the last known herd visible while the link recovers.
      return { ...base, state: 'reconnecting', view: snapshot ? buildHerdView(snapshot) : EMPTY_VIEW };
    case 'connecting':
      return { ...base, state: 'connecting', view: EMPTY_VIEW };
    case 'disconnected':
      return { ...base, state: 'offline', view: EMPTY_VIEW };
    case 'error':
      return { ...base, state: 'error', error: session.connectionError, view: EMPTY_VIEW };
  }
}
