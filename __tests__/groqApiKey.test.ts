import * as Keychain from 'react-native-keychain';

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

import * as groq from '../src/services/groqApiKey';

beforeEach(() => { mockStored = false; });

it('reports no key until one is saved', async () => {
  expect(await groq.loadGroqApiKey()).toBeNull();
});

it('saves a trimmed key to the keychain only and exposes its last four characters', async () => {
  await groq.saveGroqApiKey('  gsk_abcdefgh1234  ');
  expect(await groq.loadGroqApiKey()).toBe('gsk_abcdefgh1234');
  expect(groq.groqKeySuffix('gsk_abcdefgh1234')).toBe('1234');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'groq',
    'gsk_abcdefgh1234',
    expect.objectContaining({ service: groq.GROQ_KEYCHAIN_SERVICE }),
  );
});

it('replaces and removes the key, notifying subscribers each time', async () => {
  const listener = jest.fn();
  groq.subscribeGroqApiKey(listener);
  await groq.saveGroqApiKey('gsk_first0001');
  await groq.saveGroqApiKey('gsk_second0002');
  expect(await groq.loadGroqApiKey()).toBe('gsk_second0002');
  await groq.clearGroqApiKey();
  expect(await groq.loadGroqApiKey()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(3);
});

it('reads a key saved by an earlier app session', async () => {
  mockStored = { username: 'groq', password: 'gsk_persisted9999' };
  expect(await groq.loadGroqApiKey()).toBe('gsk_persisted9999');
});

it('rejects an empty key', async () => {
  await expect(groq.saveGroqApiKey('   ')).rejects.toThrow();
  expect(await groq.loadGroqApiKey()).toBeNull();
});
