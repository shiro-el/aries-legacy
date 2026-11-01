import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { VoiceInputSetting } from '../src/ui/hosts/VoiceInputSetting';

let mockStored: { username: string; password: string } | false = false;

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only' },
  getGenericPassword: jest.fn(() => Promise.resolve(mockStored)),
  setGenericPassword: jest.fn((username: string, password: string) => {
    mockStored = { username, password };
    return Promise.resolve(true);
  }),
  resetGenericPassword: jest.fn(() => {
    mockStored = false;
    return Promise.resolve(true);
  }),
}));

let root: ReactTestRenderer;

const texts = () => root.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
const button = (label: string) => root.root.findAll(node => node.props.accessibilityRole === 'button'
  && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`No button ${label}; saw ${texts().join(' | ')}`);
  await act(async () => { target.props.onPress(); });
};
const type = async (value: string) => {
  await act(async () => { root.root.findByType(TextInput).props.onChangeText(value); });
};
const render = async (props: Partial<React.ComponentProps<typeof VoiceInputSetting>> = {}) => {
  await act(async () => { root = renderer.create(<VoiceInputSetting {...props} />); });
};

beforeEach(() => { mockStored = false; });
afterEach(() => { act(() => root.unmount()); });

it('adds a key and shows only its last four characters', async () => {
  await render();
  expect(texts()).toContain('No Groq API key');
  await press('Add Groq API key');
  await type('gsk_secretvalue7890');
  await press('Save Groq API key');
  expect(mockStored).toEqual({ username: 'groq', password: 'gsk_secretvalue7890' });
  expect(texts()).toContain('Groq API key ending in 7890');
  expect(texts().join(' ')).not.toContain('secretvalue');
});

it('changes and removes a saved key', async () => {
  mockStored = { username: 'groq', password: 'gsk_old00001111' };
  await render();
  expect(texts()).toContain('Groq API key ending in 1111');
  await press('Change Groq API key');
  await type('gsk_new00002222');
  await press('Save Groq API key');
  expect(texts()).toContain('Groq API key ending in 2222');
  await press('Remove Groq API key');
  expect(mockStored).toBe(false);
  expect(texts()).toContain('No Groq API key');
});

it('opens the key editor when the composer sends the user here', async () => {
  await render({ editRequest: 1 });
  expect(root.root.findByType(TextInput).props.autoFocus).toBe(true);
});
