import {
  EXTRA_KEY_ROWS,
  NO_MODIFIERS,
  modifiedText,
  navigationSequence,
} from '../src/ui/terminal/terminalKeys';

const ctrl = { ctrl: true, alt: false };
const alt = { ctrl: false, alt: true };
const both = { ctrl: true, alt: true };

test('lays the keys out in two rows of seven', () => {
  expect(EXTRA_KEY_ROWS.map(row => row.map(key => key.label))).toEqual([
    ['ESC', '/', '-', 'HOME', '↑', 'END', 'PGUP'],
    ['TAB', 'CTRL', 'ALT', '←', '↓', '→', 'PGDN'],
  ]);
});

test('arrows, Home and End follow the cursor key mode when unmodified', () => {
  expect(navigationSequence('up', NO_MODIFIERS, false)).toBe('\u001b[A');
  expect(navigationSequence('up', NO_MODIFIERS, true)).toBe('\u001bOA');
  expect(navigationSequence('left', NO_MODIFIERS, false)).toBe('\u001b[D');
  expect(navigationSequence('home', NO_MODIFIERS, false)).toBe('\u001b[H');
  expect(navigationSequence('end', NO_MODIFIERS, true)).toBe('\u001bOF');
});

test('modified navigation keys carry the xterm modifier parameter', () => {
  expect(navigationSequence('right', ctrl, true)).toBe('\u001b[1;5C');
  expect(navigationSequence('left', alt, false)).toBe('\u001b[1;3D');
  expect(navigationSequence('home', both, false)).toBe('\u001b[1;7H');
  expect(navigationSequence('pageUp', NO_MODIFIERS, false)).toBe('\u001b[5~');
  expect(navigationSequence('pageDown', NO_MODIFIERS, true)).toBe('\u001b[6~');
  expect(navigationSequence('pageUp', ctrl, false)).toBe('\u001b[5;5~');
});

test('Ctrl maps characters to control bytes and Alt prefixes Escape', () => {
  expect(modifiedText('c', ctrl)).toBe('\u0003');
  expect(modifiedText('C', ctrl)).toBe('\u0003');
  expect(modifiedText('/', ctrl)).toBe('\u001f');
  expect(modifiedText('x', alt)).toBe('\u001bx');
  expect(modifiedText('c', both)).toBe('\u001b\u0003');
  expect(modifiedText('\t', alt)).toBe('\u001b\t');
});

test('characters without a control byte and longer input pass through', () => {
  expect(modifiedText('-', ctrl)).toBe('-');
  expect(modifiedText('한', ctrl)).toBe('한');
  expect(modifiedText('ls', both)).toBe('ls');
  expect(modifiedText('a', NO_MODIFIERS)).toBe('a');
});
