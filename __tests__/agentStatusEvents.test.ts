import {
  agentAlertDelivery,
  agentNotificationTitle,
  isAgentAlertingStatus,
  tabNameForAgent,
} from '../src/lib/agentStatusEvents';
import type { AgentInfo } from '../src/types';

const agent: AgentInfo = {
  terminal_id: 'terminal-1',
  agent: 'codex',
  agent_status: 'working',
  workspace_id: 'workspace-1',
  tab_id: 'tab-1',
  pane_id: 'pane-1',
  focused: true,
  revision: 1,
};

describe('agent status events', () => {
  test('treats public idle as already seen and done as completion', () => {
    expect(isAgentAlertingStatus('blocked')).toBe(true);
    expect(isAgentAlertingStatus('done')).toBe(true);
    expect(isAgentAlertingStatus('working')).toBe(false);
    expect(isAgentAlertingStatus('idle')).toBe(false);
  });

  test('only an agent that needs you can raise a persistent or brief alert', () => {
    expect(agentAlertDelivery('blocked', 'persistent', false)).toBe('persistent');
    expect(agentAlertDelivery('blocked', 'persistent', true)).toBe('brief');
    expect(agentAlertDelivery('blocked', 'regular', false)).toBe('regular');
    expect(agentAlertDelivery('done', 'persistent', false)).toBe('regular');
    expect(agentAlertDelivery('done', 'persistent', true)).toBe('regular');
  });

  test('uses the tab name and agent name in notification titles', () => {
    const tabs = [{
      tab_id: 'tab-1',
      workspace_id: 'workspace-1',
      number: 1,
      label: 'Gold research',
      focused: true,
      pane_count: 1,
      agent_status: 'working' as const,
    }];

    expect(tabNameForAgent(agent, tabs)).toBe('Gold research');
    expect(agentNotificationTitle({ ...agent, agent_status: 'done' }, 'Gold research'))
      .toBe('Gold research · codex finished');
    expect(agentNotificationTitle({ ...agent, agent_status: 'blocked' }, 'Gold research'))
      .toBe('Gold research · codex needs you');
  });
});
