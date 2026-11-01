import { useRef, useState } from 'react';

import { PolishError } from '../../services/transcriptPolish';
import { followRange, type TextRange } from './voiceText';

/** The passage to polish, and the rest of the draft around it. */
export type PolishPassage = { transcript: string; before: string; after: string };

/** The latest dictated passage, which polish may rewrite and restore. */
export type DictatedPassage = {
  range: TextRange;
  /** The transcript before polishing; set once the passage is polished. */
  original: string | null;
  busy: boolean;
  error: string | null;
};

type Edit = { text: string; caret: number };

const FAILURES: Record<PolishError['kind'], string> = {
  timeout: 'Polishing took longer than 30 seconds. The transcript is unchanged.',
  noClaude: 'Claude Code is not installed on this host.',
  malformed: 'Claude returned no usable text. The transcript is unchanged.',
  failed: 'Could not polish the transcript.',
};

/**
 * Tracks the newest transcript through edits. Editing inside it, sending, or
 * dictating again ends the offer; edits elsewhere only move it.
 */
export function useDictatedPassage(
  polish: ((passage: PolishPassage) => Promise<string>) | undefined,
  readText: () => string,
  apply: (edit: Edit) => void,
) {
  const [passage, setPassage] = useState<DictatedPassage | null>(null);
  const current = useRef(passage);
  // Bumped whenever the tracked passage is replaced, so a late result is dropped.
  const generation = useRef(0);

  const set = (next: DictatedPassage | null) => {
    current.current = next;
    setPassage(next);
  };
  const end = () => {
    generation.current += 1;
    set(null);
  };

  const replace = (range: TextRange, text: string, original: string | null) => {
    const draft = readText();
    apply({ text: draft.slice(0, range.start) + text + draft.slice(range.end), caret: range.start + text.length });
    set({ range: { start: range.start, end: range.start + text.length }, original, busy: false, error: null });
  };

  return {
    passage: polish ? passage : null,

    dictated(range: TextRange) {
      generation.current += 1;
      set({ range, original: null, busy: false, error: null });
    },

    edited(previous: string, next: string) {
      const tracked = current.current;
      if (!tracked) return;
      const range = followRange(previous, next, tracked.range);
      if (range) set({ ...tracked, range });
      else end();
    },

    end,

    async polish() {
      const tracked = current.current;
      if (!polish || !tracked || tracked.busy || tracked.original !== null) return;
      const draft = readText();
      const transcript = draft.slice(tracked.range.start, tracked.range.end);
      const started = generation.current;
      set({ ...tracked, busy: true, error: null });
      try {
        const polished = await polish({
          transcript,
          before: draft.slice(0, tracked.range.start),
          after: draft.slice(tracked.range.end),
        });
        const latest = current.current;
        if (started !== generation.current || !latest) return;
        if (readText().slice(latest.range.start, latest.range.end) !== transcript) return;
        replace(latest.range, polished, transcript);
      } catch (cause) {
        const latest = current.current;
        if (started !== generation.current || !latest) return;
        set({ ...latest, busy: false, error: FAILURES[cause instanceof PolishError ? cause.kind : 'failed'] });
      }
    },

    restore() {
      const tracked = current.current;
      if (tracked?.original == null) return;
      replace(tracked.range, tracked.original, null);
    },
  };
}
