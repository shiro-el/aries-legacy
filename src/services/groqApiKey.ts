import * as Keychain from 'react-native-keychain';

/** The Groq key is a phone-wide secret: it lives only in the keychain. */
export const GROQ_KEYCHAIN_SERVICE = 'aries.groq-api-key.v1';

const listeners = new Set<() => void>();

export function subscribeGroqApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function loadGroqApiKey(): Promise<string | null> {
  const stored = await Keychain.getGenericPassword({ service: GROQ_KEYCHAIN_SERVICE });
  return stored ? stored.password : null;
}

export async function saveGroqApiKey(value: string): Promise<void> {
  const key = value.trim();
  if (!key) throw new Error('Enter a Groq API key');
  const stored = await Keychain.setGenericPassword('groq', key, {
    service: GROQ_KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (!stored) throw new Error('Could not store the Groq API key');
  notify();
}

export async function clearGroqApiKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: GROQ_KEYCHAIN_SERVICE });
  notify();
}

export const groqKeySuffix = (key: string): string => key.slice(-4);

function notify(): void {
  for (const listener of listeners) listener();
}
