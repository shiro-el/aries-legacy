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
