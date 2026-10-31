import { codeSegments, spansByLine } from '../src/ui/workbench/syntax';

const span = (start: number, end: number, color: string, extra: { bold?: boolean; italic?: boolean } = {}) =>
  ({ start, end, color, bold: extra.bold ?? false, italic: extra.italic ?? false });

describe('codeSegments', () => {
  it('keeps an unstyled line whole with tabs expanded', () => {
    expect(codeSegments('\tx')).toEqual([{ text: '    x' }]);
  });

  it('colors runs and leaves gaps plain', () => {
    expect(codeSegments('const a = 1', [span(0, 5, '#f00', { bold: true }), span(10, 11, '#0f0')])).toEqual([
      { text: 'const', color: '#f00', bold: true },
      { text: ' a = ' },
      { text: '1', color: '#0f0' },
    ]);
  });

  it('marks changed words across syntax runs', () => {
    expect(codeSegments('ab cd', [span(0, 5, '#111')], [{ start: 1, end: 4 }])).toEqual([
      { text: 'a', color: '#111' },
      { text: 'b c', color: '#111', changed: true },
      { text: 'd', color: '#111' },
    ]);
  });

  it('counts offsets in UTF-16 units and expands tabs inside runs', () => {
    expect(codeSegments('😀\tx', [span(0, 2, '#abc'), span(3, 4, '#def')])).toEqual([
      { text: '😀', color: '#abc' },
      { text: '    ' },
      { text: 'x', color: '#def' },
    ]);
  });
});

describe('spansByLine', () => {
  it('rebases spans to their lines and cuts ones that cross a newline', () => {
    const text = 'ab\n/* c\nd */\n';
    expect(spansByLine(text, [span(0, 2, '#1'), span(3, 12, '#2')])).toEqual([
      [span(0, 2, '#1')],
      [span(0, 4, '#2')],
      [span(0, 4, '#2')],
      [],
    ]);
  });
});
