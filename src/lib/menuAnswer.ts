import type { NativeAgentInteractionPrompt } from 'react-native-whip-ssh';

type Choice = NativeAgentInteractionPrompt['choices'][number];

/** Claude and Codex questions end with a row that becomes a text field once selected. */
const FREE_TEXT_LABEL = /^(?:type something\.?|other(?: \(write an answer\))?)$/i;

/**
 * Where a typed message goes while the agent waits on a menu: the menu's
 * free-text row, or null when the menu only takes one of its choices.
 */
export function freeTextChoice(prompt: NativeAgentInteractionPrompt): Choice | null {
  if (prompt.kind !== 'menu') return null;
  return prompt.choices.filter(choice => FREE_TEXT_LABEL.test(choice.label.split('\n')[0].trim())).at(-1) ?? null;
}
