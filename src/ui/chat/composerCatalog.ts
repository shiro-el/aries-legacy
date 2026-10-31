import type { AgentCatalogEntry } from 'react-native-whip-ssh';

import type { ChatAgent } from '../../lib/agentChatSession';

export type Selection = { start: number; end: number };
export type Edit = { text: string; caret: number };

const COMMAND_LIMIT = 8;

/**
 * The command name being typed, while the caret is still inside a leading
 * `/name` token. Null once the message is past its first word.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null;
  const head = text.slice(1, caret);
  return /\s/.test(head) ? null : head;
}

/** Commands whose name starts with the query, then ones that contain it. */
export function matchCommands(commands: readonly AgentCatalogEntry[], query: string): AgentCatalogEntry[] {
  const needle = query.toLowerCase();
  const starts: AgentCatalogEntry[] = [];
  const contains: AgentCatalogEntry[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) starts.push(command);
    else if (needle && name.includes(needle)) contains.push(command);
  }
  return [...starts, ...contains].slice(0, COMMAND_LIMIT);
}

/** Replaces the leading `/partial` token with the chosen command. */
export function insertCommand(text: string, name: string): Edit {
  const rest = text.replace(/^\/\S*/, '').replace(/^\s+/, '');
  const head = `/${name} `;
  return { text: head + rest, caret: head.length };
}

/** How each agent invokes a skill from its prompt. */
export function skillToken(agent: ChatAgent | null, name: string): string {
  return agent === 'codex' ? `$${name}` : `/${name}`;
}

/** Puts a token where the selection is, separated from the words around it. */
export function insertToken(text: string, selection: Selection, token: string): Edit {
  const start = Math.min(selection.start, selection.end, text.length);
  const end = Math.min(Math.max(selection.start, selection.end), text.length);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const inserted = `${lead}${token} `;
  const tail = after.replace(/^ /, '');
  return { text: before + inserted + tail, caret: before.length + inserted.length };
}

/** The terminal-only command a message starts with, if any. */
export function terminalOnlyCommand(text: string, commands: readonly AgentCatalogEntry[]): AgentCatalogEntry | null {
  const match = /^\/(\S+)/.exec(text.trim());
  if (!match) return null;
  return commands.find(command => command.terminalOnly && command.name === match[1]) ?? null;
}

export function filterSkills(skills: readonly AgentCatalogEntry[], query: string): AgentCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...skills];
  return skills.filter(skill =>
    skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
}

// Rust reports these three; anything else is unknown.
const SOURCES: Record<string, string> = { user: 'Personal', project: 'Project', plugin: 'Plugin' };

/** Where a skill comes from, or null when the agent did not say. */
export function skillSource(source: string | undefined): string | null {
  if (!source) return null;
  return SOURCES[source] ?? null;
}
