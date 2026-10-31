import { folderLabel, folderSuggestions, launchFor, parentFolder } from '../src/ui/herd/newTask';

describe('launchFor', () => {
  it('passes Claude model and effort flags', () => {
    expect(launchFor('claude', { model: 'opus', effort: 'high' }))
      .toEqual({ type: 'agent', kind: 'claude', args: ['--model', 'opus', '--effort', 'high'] });
  });

  it('passes Codex model and reasoning effort', () => {
    expect(launchFor('codex', { model: 'gpt-6.1-sol', effort: 'xhigh' }))
      .toEqual({ type: 'agent', kind: 'codex', args: ['-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=xhigh'] });
  });

  it('leaves blank choices to the agent default', () => {
    expect(launchFor('codex', { model: ' ', effort: '' })).toEqual({ type: 'agent', kind: 'codex', args: [] });
    expect(launchFor('shell', { model: 'opus', effort: 'high' })).toEqual({ type: 'shell' });
  });
});

describe('folders', () => {
  it('labels a workspace by its last segment', () => {
    expect(folderLabel('/home/me/Github/aries/')).toBe('aries');
    expect(folderLabel('~')).toBe('home');
    expect(folderLabel('/')).toBe('/');
    expect(folderLabel('  ')).toBe('');
  });

  it('suggests recent folders first without duplicates', () => {
    expect(folderSuggestions(['/a', '/b'], ['/b', undefined, '', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(folderSuggestions([], ['/a', '/b', '/c'], 2)).toEqual(['/a', '/b']);
  });

  it('walks up to the root', () => {
    expect(parentFolder('/home/me')).toBe('/home');
    expect(parentFolder('/home')).toBe('/');
    expect(parentFolder('/')).toBe('/');
  });
});
