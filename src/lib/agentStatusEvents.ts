import type { AgentAlertDelivery } from '../services/alerts';
import type { AgentAlertLevel } from '../services/devicePreferences';
import type { AgentInfo, AgentStatus, TabInfo } from '../types';

export function isAgentAlertingStatus(status: AgentStatus): boolean {
  return status === 'blocked' || status === 'done';
}

/** A finished agent can wait, so only one that needs you rings or vibrates. */
export function agentAlertDelivery(
  status: AgentStatus,
  level: AgentAlertLevel,
  appHasFocus: boolean,
): AgentAlertDelivery {
  if (status !== 'blocked' || level === 'regular') return 'regular';
  return appHasFocus ? 'brief' : 'persistent';
}

export function tabNameForAgent(
  agent: Pick<AgentInfo, 'tab_id'>,
  tabs: TabInfo[],
): string {
  const label = tabs.find(tab => tab.tab_id === agent.tab_id)?.label.trim();
  return label || agent.tab_id;
}

export function agentNotificationTitle(
  agent: AgentInfo,
  tabName?: string,
  labels?: { needsYou: (name: string) => string; finished: (name: string) => string },
): string {
  const name = agent.display_agent || agent.name || agent.agent || agent.pane_id;
  const action = agent.agent_status === 'blocked'
    ? labels?.needsYou(name) || `${name} needs you`
    : labels?.finished(name) || `${name} finished`;
  const label = tabName?.trim();
  return label ? `${label} · ${action}` : action;
}
