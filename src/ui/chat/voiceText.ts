import type { Selection } from './composerCatalog';

/** Where dictated text sits in the draft. */
export type TextRange = { start: number; end: number };

export type Insertion = { text: string; caret: number; range: TextRange };

const OPENS_WITHOUT_SPACE = /^[\s.,!?;:)\]}]/;

/** Puts a transcript at the selection, with a space on each side where words meet. */
export function insertTranscript(text: string, selection: Selection, transcript: string): Insertion {
  const start = Math.min(selection.start, selection.end, text.length);
  const end = Math.min(Math.max(selection.start, selection.end), text.length);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !OPENS_WITHOUT_SPACE.test(after) ? ' ' : '';
  const rangeStart = before.length + lead.length;
  const rangeEnd = rangeStart + transcript.length;
  return {
    text: before + lead + transcript + trail + after,
    caret: rangeEnd,
    range: { start: rangeStart, end: rangeEnd },
  };
}

/**
 * Follows a range through one edit. An edit inside the range, or one that
 * replaces part of it, ends tracking; an edit elsewhere only moves it.
 */
export function followRange(previous: string, next: string, range: TextRange): TextRange | null {
  if (previous === next) return range;
  let prefix = 0;
  const shortest = Math.min(previous.length, next.length);
  while (prefix < shortest && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const editStart = prefix;
  const editEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  if (editEnd <= range.start && editStart < range.start) return { start: range.start + delta, end: range.end + delta };
  if (editStart >= range.end && editEnd > range.end) return range;
  // A pure insertion right at either edge stays outside the range.
  if (editStart === editEnd && editStart === range.start) return { start: range.start + delta, end: range.end + delta };
  if (editStart === editEnd && editStart === range.end) return range;
  return null;
}

export type RecentMessage = { role: 'user' | 'assistant'; text: string };

/** The text of the last messages in a conversation, oldest first. */
export function recentMessages(
  messages: readonly { role: 'user' | 'assistant'; parts: readonly { type: string; text?: string }[] }[],
  count: number,
): RecentMessage[] {
  const recent: RecentMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && recent.length < count; index -= 1) {
    const message = messages[index];
    const text = message.parts
      .flatMap(part => (part.type === 'text' && part.text ? [part.text] : []))
      .join('\n')
      .trim();
    if (text) recent.unshift({ role: message.role, text });
  }
  return recent;
}
