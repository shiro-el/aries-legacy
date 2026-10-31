import type { RuntimeGitDiffSpan, RuntimeSyntaxSpan } from 'react-native-whip-ssh';

import { codeText } from './workbench';

/** A run of one line drawn in one style. */
export type CodeSegment = {
  text: string;
  /** Syntax color; none means the view's text color. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  /** Part of the words a diff line changed. */
  changed?: boolean;
};

/**
 * Cuts one line into styled runs. Offsets are UTF-16 indices into the line
 * before tabs are expanded, which is how JavaScript indexes strings; tabs are
 * expanded inside each run afterwards.
 */
export function codeSegments(
  line: string,
  syntax: readonly RuntimeSyntaxSpan[] = [],
  changed: readonly RuntimeGitDiffSpan[] = [],
): CodeSegment[] {
  if (syntax.length === 0 && changed.length === 0) return [{ text: codeText(line) }];
  const cuts = new Set([0, line.length]);
  for (const span of [...syntax, ...changed]) {
    cuts.add(clamp(span.start, line.length));
    cuts.add(clamp(span.end, line.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: CodeSegment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const style = syntax.find(span => span.start <= start && span.end > start);
    const segment: CodeSegment = { text: codeText(line.slice(start, end)) };
    if (style) {
      segment.color = style.color;
      if (style.bold) segment.bold = true;
      if (style.italic) segment.italic = true;
    }
    if (changed.some(span => span.start <= start && span.end > start)) segment.changed = true;
    segments.push(segment);
  }
  return segments;
}

/**
 * Splits spans over a whole file into spans per line, each rebased to its
 * line's start. Lines are separated by `\n`; a span crossing one is cut.
 */
export function spansByLine(text: string, spans: readonly RuntimeSyntaxSpan[]): RuntimeSyntaxSpan[][] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  const lines: RuntimeSyntaxSpan[][] = starts.map(() => []);
  let line = 0;
  for (const span of spans) {
    while (line + 1 < starts.length && starts[line + 1] <= span.start) line++;
    for (let at = line; at < starts.length && starts[at] < span.end; at++) {
      const lineStart = starts[at];
      const lineEnd = at + 1 < starts.length ? starts[at + 1] - 1 : text.length;
      const start = Math.max(span.start, lineStart) - lineStart;
      const end = Math.min(span.end, lineEnd) - lineStart;
      if (end > start) lines[at].push({ ...span, start, end });
    }
  }
  return lines;
}

function clamp(value: number, length: number): number {
  return Math.max(0, Math.min(length, value));
}
