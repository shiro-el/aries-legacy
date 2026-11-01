import {
  TranscriptionError,
  transcribeWithGroq,
  transcriptionPrompt,
} from '../src/services/groqTranscription';

// React Native's FormData keeps file descriptors as objects; Node's stringifies them.
class NativeFormData {
  private readonly parts: [string, unknown][] = [];
  append(name: string, value: unknown) { this.parts.push([name, value]); }
  get(name: string) { return this.parts.find(([key]) => key === name)?.[1] ?? null; }
}
const nodeFormData = global.FormData;
beforeAll(() => { global.FormData = NativeFormData as unknown as typeof FormData; });
afterAll(() => { global.FormData = nodeFormData; });

const response = (status: number, body: unknown) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
} as Response);

it('posts the recording to Groq whisper-large-v3 in Korean with the context prompt', async () => {
  const fetch = jest.fn((_url: string, _init: RequestInit) => response(200, { text: ' 안녕 WhipSsh ' }));
  const text = await transcribeWithGroq({ uri: 'file:///cache/Audio/voice.m4a', apiKey: 'gsk_key', prompt: 'WhipSsh, Composer' }, fetch);
  expect(text).toBe('안녕 WhipSsh');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
  expect(init.method).toBe('POST');
  expect(init.headers).toEqual({ Authorization: 'Bearer gsk_key' });
  const form = init.body as FormData;
  expect(form.get('model')).toBe('whisper-large-v3');
  expect(form.get('language')).toBe('ko');
  expect(form.get('response_format')).toBe('json');
  expect(form.get('prompt')).toBe('WhipSsh, Composer');
  expect(form.get('file')).toEqual(expect.objectContaining({ uri: 'file:///cache/Audio/voice.m4a', type: 'audio/mp4' }));
});

it('omits an empty prompt', async () => {
  const fetch = jest.fn((_url: string, _init: RequestInit) => response(200, { text: 'x' }));
  await transcribeWithGroq({ uri: 'file:///a.m4a', apiKey: 'k', prompt: '' }, fetch);
  expect((fetch.mock.calls[0][1].body as FormData).get('prompt')).toBeNull();
});

it.each([
  [401, 'unauthorized'],
  [403, 'unauthorized'],
  [429, 'rateLimited'],
  [500, 'failed'],
])('reports HTTP %i as %s', async (status, kind) => {
  const fetch = jest.fn(() => response(status, { error: { message: 'nope' } }));
  await expect(transcribeWithGroq({ uri: 'file:///a.m4a', apiKey: 'k', prompt: '' }, fetch))
    .rejects.toMatchObject({ kind });
});

it('reports a failed request as a network error', async () => {
  const fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
  const failure = transcribeWithGroq({ uri: 'file:///a.m4a', apiKey: 'k', prompt: '' }, fetch);
  await expect(failure).rejects.toBeInstanceOf(TranscriptionError);
  await expect(failure).rejects.toMatchObject({ kind: 'network' });
});

it('keeps the prompt inside Whisper\'s 224-token window, most relevant hints first', () => {
  const hints = Array.from({ length: 100 }, (_, index) => `identifier_number_${index}`);
  const prompt = transcriptionPrompt(hints);
  expect(prompt.startsWith('identifier_number_0, identifier_number_1')).toBe(true);
  expect(prompt).not.toContain('identifier_number_99');
  // Byte-level BPE needs at most one token per UTF-8 byte.
  expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(224);
  expect(prompt.endsWith(',')).toBe(false);
});

it('budgets Hangul by its bytes so a Korean prompt also stays inside the window', () => {
  const prompt = transcriptionPrompt(Array.from({ length: 100 }, () => '음성입력기능'));
  expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(224);
  expect(prompt.length).toBeGreaterThan(0);
});
