import { appStorage } from './appStorage';
import { settledPromise } from '../lib/promises';

export type NewTaskAgent = 'claude' | 'codex';
export type NewTaskChoice = { model: string; effort: string };
export type NewTaskPreferences = {
  folders: string[];
  agents: Partial<Record<NewTaskAgent, NewTaskChoice>>;
};
const PREFIX = 'whip.new-task.v1.';
const writes = new Map<string, Promise<void>>();

export async function loadNewTaskPreferences(
  hostId: string,
): Promise<NewTaskPreferences> {
  await writes.get(hostId);
  const raw = await appStorage.getItem(`${PREFIX}${hostId}`);
  if (!raw) return { folders: [], agents: {} };
  const value = JSON.parse(raw) as NewTaskPreferences;
  if (
    !Array.isArray(value.folders) ||
    !value.folders.every(path => typeof path === 'string') ||
    !value.agents ||
    typeof value.agents !== 'object'
  ) {
    throw new Error('Invalid new task preferences');
  }
  const agents: NewTaskPreferences['agents'] = {};
  for (const kind of ['claude', 'codex'] as const) {
    const choice = value.agents[kind];
    if (
      choice &&
      typeof choice.model === 'string' &&
      typeof choice.effort === 'string'
    )
      agents[kind] = choice;
  }
  return { folders: value.folders.slice(0, 20), agents };
}

export async function rememberNewTask(
  hostId: string,
  folder: string,
  kind?: NewTaskAgent,
  choice?: NewTaskChoice,
): Promise<void> {
  const previous = writes.get(hostId) ?? Promise.resolve();
  // Read before publishing this operation, so loading never waits on itself.
  const operation = previous.then(async () => {
    const raw = await appStorage.getItem(`${PREFIX}${hostId}`);
    const value = raw
      ? (JSON.parse(raw) as NewTaskPreferences)
      : { folders: [], agents: {} };
    await appStorage.setItem(
      `${PREFIX}${hostId}`,
      JSON.stringify({
        folders: [
          folder,
          ...value.folders.filter(path => path !== folder),
        ].slice(0, 20),
        agents:
          kind && choice ? { ...value.agents, [kind]: choice } : value.agents,
      }),
    );
  });
  writes.set(hostId, settledPromise(operation));
  await operation;
}
