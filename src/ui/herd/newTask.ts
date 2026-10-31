import type { TabLaunchIntent } from '../../lib/herdrCreationFlows';
import type { NewTaskAgent, NewTaskChoice } from '../../services/newTaskPreferences';

export type FirstPane = NewTaskAgent | 'shell';

type AgentOptions = { name: string; models: readonly string[]; efforts: readonly string[] };

// Shortcuts only: a blank model or effort leaves the agent's own default, and
// any other model ID can be typed. Read from `claude --help` 2.1.316 and
// `codex debug models` 0.165.0.
export const AGENTS: Readonly<Record<NewTaskAgent, AgentOptions>> = {
  claude: {
    name: 'Claude Code',
    models: ['fable', 'opus', 'sonnet', 'haiku'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  codex: {
    name: 'Codex',
    models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  },
};

/** Typed CLI arguments for the first pane; nothing extra for a blank choice. */
export function launchFor(pane: FirstPane, choice: NewTaskChoice): TabLaunchIntent {
  if (pane === 'shell') return { type: 'shell' };
  const model = choice.model.trim();
  const effort = choice.effort.trim();
  const args = pane === 'claude'
    ? [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])]
    : [...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : [])];
  return { type: 'agent', kind: pane, args };
}

/** The last path segment, used as the workspace label. */
export function folderLabel(path: string): string {
  const value = path.trim();
  const trimmed = value.replace(/\/+$/, '');
  if (!trimmed) return value ? '/' : '';
  if (trimmed === '~') return 'home';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
}

/** Recent task folders first, then folders panes already work in. */
export function folderSuggestions(recent: readonly string[], paneFolders: readonly (string | undefined)[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of [...recent, ...paneFolders]) {
    const value = path?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length === limit) break;
  }
  return out;
}

/** Parent of a remote directory; the root is its own parent. */
export function parentFolder(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}
