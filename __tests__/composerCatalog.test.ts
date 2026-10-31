import type { AgentCatalogEntry } from 'react-native-whip-ssh';

import {
  filterSkills,
  insertCommand,
  insertToken,
  matchCommands,
  skillSource,
  skillToken,
  slashQuery,
  terminalOnlyCommand,
} from '../src/ui/chat/composerCatalog';

const entry = (name: string, extra: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry => ({
  name,
  description: '',
  argumentHint: '',
  terminalOnly: false,
  ...extra,
});

describe('slashQuery', () => {
  it('reads the command name while the caret is in the first word', () => {
    expect(slashQuery('/mo', 3)).toBe('mo');
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/model opus', 4)).toBe('mod');
  });

  it('stops once the message is past the command', () => {
    expect(slashQuery('/model opus', 9)).toBeNull();
    expect(slashQuery('hello /x', 8)).toBeNull();
  });
});

describe('matchCommands', () => {
  it('ranks prefix matches before substring matches', () => {
    const commands = [entry('review'), entry('preview'), entry('compact')];
    expect(matchCommands(commands, 'rev').map(c => c.name)).toEqual(['review', 'preview']);
  });

  it('lists every command for a bare slash, up to the limit', () => {
    const commands = Array.from({ length: 12 }, (_, i) => entry(`c${i}`));
    expect(matchCommands(commands, '')).toHaveLength(8);
  });
});

describe('insertCommand', () => {
  it('replaces the partial token and keeps the rest of the message', () => {
    expect(insertCommand('/mo', 'model')).toEqual({ text: '/model ', caret: 7 });
    expect(insertCommand('/re  the branch', 'review')).toEqual({ text: '/review the branch', caret: 8 });
  });
});

describe('insertToken', () => {
  it('inserts at the caret with spaces around the token', () => {
    expect(insertToken('use please', { start: 3, end: 3 }, '$ship')).toEqual({ text: 'use $ship please', caret: 10 });
    expect(insertToken('', { start: 0, end: 0 }, '/guide')).toEqual({ text: '/guide ', caret: 7 });
  });

  it('replaces a selection', () => {
    expect(insertToken('run old now', { start: 4, end: 7 }, '$new')).toEqual({ text: 'run $new now', caret: 9 });
  });
});

describe('skills', () => {
  it('uses each agent syntax', () => {
    expect(skillToken('codex', 'ship')).toBe('$ship');
    expect(skillToken('claude', 'ship')).toBe('/ship');
  });

  it('searches names and descriptions', () => {
    const skills = [entry('ship', { description: 'Release a build' }), entry('guide')];
    expect(filterSkills(skills, 'release').map(s => s.name)).toEqual(['ship']);
    expect(filterSkills(skills, ' ')).toHaveLength(2);
  });

  it('labels only the sources Rust reports', () => {
    expect(skillSource('plugin')).toBe('Plugin');
    expect(skillSource('new')).toBeNull();
    expect(skillSource(undefined)).toBeNull();
  });
});

describe('terminalOnlyCommand', () => {
  it('finds a terminal-only command at the start of a message', () => {
    const commands = [entry('permissions', { terminalOnly: true }), entry('model')];
    expect(terminalOnlyCommand('/permissions', commands)?.name).toBe('permissions');
    expect(terminalOnlyCommand('/model opus', commands)).toBeNull();
    expect(terminalOnlyCommand('see /permissions', commands)).toBeNull();
  });
});
