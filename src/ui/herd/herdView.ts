import type { AgentStatus } from '../../types';
import type { WhipHostSnapshot } from 'react-native-whip-ssh';

export type HerdPane = {
  paneId: string;
  /** Agent name, or "shell" for a pane without a detected agent. */
  name: string;
  status: AgentStatus;
  detail?: string;
};

export type HerdTab = { tabId: string; label: string; panes: HerdPane[] };

export type HerdWorkspace = { workspaceId: string; label: string; tabs: HerdTab[] };

export type HerdView = {
  workspaces: HerdWorkspace[];
  /** Blocked or done: the agents shown in gold. */
  needYou: number;
  working: number;
};

type Snapshot = Pick<WhipHostSnapshot, 'workspaces' | 'tabs' | 'panes'>;

/** Groups a Herdr snapshot into workspace → tab → pane, in Herdr's own order. */
export function buildHerdView(snapshot: Snapshot): HerdView {
  let needYou = 0;
  let working = 0;

  const panesByTab = new Map<string, HerdPane[]>();
  for (const pane of snapshot.panes) {
    const status: AgentStatus = pane.agent_status;
    if (status === 'blocked' || status === 'done') needYou += 1;
    if (status === 'working') working += 1;
    const list = panesByTab.get(pane.tab_id) ?? [];
    list.push({
      paneId: pane.pane_id,
      name: pane.display_agent ?? pane.agent ?? 'shell',
      status,
      detail: firstNonEmpty(
        pane.terminal_title_stripped,
        pane.title,
        pane.foreground_cwd ?? pane.cwd,
      ),
    });
    panesByTab.set(pane.tab_id, list);
  }

  const tabsByWorkspace = new Map<string, HerdTab[]>();
  for (const tab of [...snapshot.tabs].sort((a, b) => a.number - b.number)) {
    const panes = panesByTab.get(tab.tab_id);
    if (!panes?.length) continue;
    const list = tabsByWorkspace.get(tab.workspace_id) ?? [];
    list.push({ tabId: tab.tab_id, label: tab.label, panes });
    tabsByWorkspace.set(tab.workspace_id, list);
  }

  const workspaces = [...snapshot.workspaces]
    .sort((a, b) => a.number - b.number)
    .flatMap(workspace => {
      const tabs = tabsByWorkspace.get(workspace.workspace_id);
      return tabs ? [{ workspaceId: workspace.workspace_id, label: workspace.label, tabs }] : [];
    });

  return { workspaces, needYou, working };
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find(value => value !== undefined && value.trim() !== '');
}
