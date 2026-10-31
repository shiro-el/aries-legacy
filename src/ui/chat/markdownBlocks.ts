export type Block =
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'heading'; text: string }
  | { kind: 'item'; text: string; marker: string; depth: number }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string };

/** Splits agent markdown into the few block shapes agents actually write. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: para.join(' ') });
    para = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) body.push(lines[index++]);
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[2] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const marker = /\d/.test(item[2]) ? item[2] : '–';
      blocks.push({ kind: 'item', text: item[3], marker, depth: Math.min(3, Math.floor(item[1].length / 2)) });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: 'quote', text: quote[1] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
