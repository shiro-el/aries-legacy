import { legacyControlCharacter } from '../../lib/terminalControlCharacter.cjs';

export type Modifier = 'ctrl' | 'alt';
export type Modifiers = Readonly<Record<Modifier, boolean>>;
export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false };

/** Keys that send an escape sequence rather than a character. */
export type NavigationKey = 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageUp' | 'pageDown';

export type ExtraKey =
  | { kind: 'text'; text: '\u001b' | '\t' | '/' | '-'; label: string; a11y: string }
  | { kind: 'navigation'; key: NavigationKey; label: string; a11y: string }
  | { kind: 'modifier'; modifier: Modifier; label: string; a11y: string };

const text = (value: Extract<ExtraKey, { kind: 'text' }>['text'], label: string, a11y: string): ExtraKey =>
  ({ kind: 'text', text: value, label, a11y });
const nav = (key: NavigationKey, label: string, a11y: string): ExtraKey => ({ kind: 'navigation', key, label, a11y });
const mod = (modifier: Modifier, label: string, a11y: string): ExtraKey => ({ kind: 'modifier', modifier, label, a11y });

/** Two rows, the arrows in an inverted T: ↑ above ↓, between ← and →. */
export const EXTRA_KEY_ROWS: readonly (readonly ExtraKey[])[] = [
  [
    text('\u001b', 'ESC', 'Escape'),
    text('/', '/', 'Slash'),
    text('-', '-', 'Minus'),
    nav('home', 'HOME', 'Home'),
    nav('up', '↑', 'Up'),
    nav('end', 'END', 'End'),
    nav('pageUp', 'PGUP', 'Page up'),
  ],
  [
    text('\t', 'TAB', 'Tab'),
    mod('ctrl', 'CTRL', 'Control, applies to the next key'),
    mod('alt', 'ALT', 'Alt, applies to the next key'),
    nav('left', '←', 'Left'),
    nav('down', '↓', 'Down'),
    nav('right', '→', 'Right'),
    nav('pageDown', 'PGDN', 'Page down'),
  ],
];

/** xterm's modifier parameter: 1 plus Alt 2 plus Ctrl 4. */
function modifierParameter(modifiers: Modifiers): number {
  return 1 + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
}

const FINAL: Readonly<Record<Exclude<NavigationKey, 'pageUp' | 'pageDown'>, string>> = {
  up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F',
};

/**
 * The sequence xterm sends for a navigation key. Arrows, Home and End follow
 * the application cursor mode (DECCKM) when unmodified; a modifier always
 * uses the CSI form with its parameter.
 */
export function navigationSequence(key: NavigationKey, modifiers: Modifiers, applicationCursorKeys: boolean): string {
  const modified = modifiers.ctrl || modifiers.alt;
  if (key === 'pageUp' || key === 'pageDown') {
    const code = key === 'pageUp' ? 5 : 6;
    return modified ? `\u001b[${code};${modifierParameter(modifiers)}~` : `\u001b[${code}~`;
  }
  if (modified) return `\u001b[1;${modifierParameter(modifiers)}${FINAL[key]}`;
  return `\u001b${applicationCursorKeys ? 'O' : '['}${FINAL[key]}`;
}

/**
 * Typed text under latched modifiers. Ctrl maps a single character to its
 * control byte where one exists; Alt prefixes Escape. Longer input, such as a
 * finished IME composition, passes through unchanged.
 */
export function modifiedText(data: string, modifiers: Modifiers): string {
  if (data.length !== 1) return data;
  const control = modifiers.ctrl ? legacyControlCharacter(data) ?? data : data;
  return modifiers.alt ? `\u001b${control}` : control;
}

export function keySequence(
  key: Exclude<ExtraKey, { kind: 'modifier' }>,
  modifiers: Modifiers,
  applicationCursorKeys: boolean,
): string {
  return key.kind === 'navigation'
    ? navigationSequence(key.key, modifiers, applicationCursorKeys)
    : modifiedText(key.text, modifiers);
}
