import { buildHerdView } from '../src/ui/herd/herdView';

const ws = (id: string, number: number, label: string) => ({
  workspace_id: id, number, label, focused: false, pane_count: 0, tab_count: 0,
  active_tab_id: '', agent_status: 'idle' as const,
});
const tab = (id: string, workspace: string, number: number, label: string) => ({
  tab_id: id, workspace_id: workspace, number, label, focused: false, pane_count: 0,
  agent_status: 'idle' as const,
});
type Status = 'blocked' | 'done' | 'working' | 'idle' | 'unknown';
const pane = (id: string, workspace: string, tabId: string, extra: { agent_status?: Status; [key: string]: unknown } = {}) => ({
  pane_id: id, terminal_id: id, workspace_id: workspace, tab_id: tabId, focused: false,
  agent_status: 'unknown' as Status, revision: 0, ...extra,
});

describe('buildHerdView', () => {
  it('groups panes under tabs and workspaces in Herdr order', () => {
    const view = buildHerdView({
      workspaces: [ws('w2', 2, 'dotfiles'), ws('w1', 1, 'aries')],
      tabs: [tab('t2', 'w1', 2, 'relay'), tab('t1', 'w1', 1, 'ui'), tab('t3', 'w2', 1, 'main')],
      panes: [pane('p1', 'w1', 't1'), pane('p2', 'w1', 't2'), pane('p3', 'w2', 't3')],
    });
    expect(view.workspaces.map(w => [w.label, w.tabs.map(t => t.label)])).toEqual([
      ['aries', ['ui', 'relay']],
      ['dotfiles', ['main']],
    ]);
  });

  it('names agent panes by agent and plain panes as shell', () => {
    const view = buildHerdView({
      workspaces: [ws('w1', 1, 'aries')],
      tabs: [tab('t1', 'w1', 1, 'ui')],
      panes: [
        pane('p1', 'w1', 't1', { cwd: '/repo' }),
        pane('p2', 'w1', 't1', { agent_status: 'blocked', agent: 'claude', terminal_title_stripped: 'Allow edit?' }),
      ],
    });
    expect(view.workspaces[0].tabs[0].panes).toEqual([
      { paneId: 'p1', name: 'shell', status: 'unknown', detail: '/repo' },
      { paneId: 'p2', name: 'claude', status: 'blocked', detail: 'Allow edit?' },
    ]);
  });

  it('counts blocked and done as needing you', () => {
    const view = buildHerdView({
      workspaces: [ws('w1', 1, 'aries')],
      tabs: [tab('t1', 'w1', 1, 'ui')],
      panes: (['blocked', 'done', 'working', 'idle'] as const).map((status, i) =>
        pane(`p${i}`, 'w1', 't1', { agent_status: status })),
    });
    expect([view.needYou, view.working]).toEqual([2, 1]);
  });

  it('drops tabs and workspaces with no panes', () => {
    const view = buildHerdView({
      workspaces: [ws('w1', 1, 'empty')],
      tabs: [tab('t1', 'w1', 1, 'ui')],
      panes: [],
    });
    expect(view.workspaces).toEqual([]);
  });
});
