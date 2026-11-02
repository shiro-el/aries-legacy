import type { NativeAgentInteractionPrompt } from 'react-native-whip-ssh';

import { freeTextChoice } from '../src/lib/menuAnswer';

const menu = (labels: string[], kind: NativeAgentInteractionPrompt['kind'] = 'menu'): NativeAgentInteractionPrompt => ({
  token: 't',
  kind,
  summary: 'Which one?',
  text: '',
  choices: labels.map((label, index) => ({ label, index, selected: index === 0 })),
});

it("finds the row of Claude's question that takes typed text", () => {
  expect(freeTextChoice(menu(['Good\nIt shows', 'Bad', 'Type something.', 'Chat about this']))?.index).toBe(2);
});

it('finds none in a menu that only takes its choices', () => {
  expect(freeTextChoice(menu(['Yes, proceed', 'No']))).toBeNull();
});

it('finds none outside a menu', () => {
  expect(freeTextChoice(menu(['Type something.'], 'terminal'))).toBeNull();
});

it('finds the Other row of Codex async questions for a typed answer', () => {
  expect(freeTextChoice(menu(['A', 'B', 'Other']))?.index).toBe(2);
});

it('uses Codex’s last Other row when a named option is also Other', () => {
  expect(freeTextChoice(menu(['A', 'Other', 'Other (write an answer)']))?.index).toBe(2);
});
