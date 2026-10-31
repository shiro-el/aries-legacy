import { parseBlocks } from '../src/ui/chat/markdownBlocks';

describe('parseBlocks', () => {
  it('splits paragraphs, headings, lists and fenced code', () => {
    const blocks = parseBlocks([
      '## Result',
      'Tests pass',
      'on main.',
      '',
      '- one',
      '  - nested',
      '1. first',
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
      '> quoted',
    ].join('\n'));
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Result' },
      { kind: 'para', text: 'Tests pass on main.' },
      { kind: 'item', text: 'one', marker: '–', depth: 0 },
      { kind: 'item', text: 'nested', marker: '–', depth: 1 },
      { kind: 'item', text: 'first', marker: '1.', depth: 0 },
      { kind: 'code', text: 'const a = 1;\n\nconst b = 2;', lang: 'ts' },
      { kind: 'quote', text: 'quoted' },
    ]);
  });

  it('keeps an unterminated fence as code', () => {
    expect(parseBlocks('```\nstill streaming')).toEqual([{ kind: 'code', text: 'still streaming', lang: '' }]);
  });
});
