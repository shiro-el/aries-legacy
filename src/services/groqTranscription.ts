const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const LANGUAGE = 'ko';
// Whisper reads at most 224 prompt tokens. The budget leaves headroom for
// the estimate below, which no tokenizer on the phone can check exactly.
const PROMPT_TOKEN_BUDGET = 200;

export type TranscriptionFailure = 'unauthorized' | 'rateLimited' | 'network' | 'failed';

export class TranscriptionError extends Error {
  constructor(readonly kind: TranscriptionFailure, message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export type TranscriptionRequest = {
  /** A local m4a recording. */
  uri: string;
  apiKey: string;
  /** Context words that steer spelling; empty for none. */
  prompt: string;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Sends one recording to Groq and returns its text. */
export async function transcribeWithGroq(request: TranscriptionRequest, fetchImpl: Fetch = fetch): Promise<string> {
  const form = new FormData();
  // React Native uploads a local file from this descriptor.
  form.append('file', { uri: request.uri, name: 'voice.m4a', type: 'audio/mp4' } as unknown as Blob);
  form.append('model', MODEL);
  form.append('language', LANGUAGE);
  form.append('response_format', 'json');
  if (request.prompt) form.append('prompt', request.prompt);

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.apiKey}` },
      body: form,
    });
  } catch (cause) {
    throw new TranscriptionError('network', cause instanceof Error ? cause.message : String(cause));
  }
  if (!response.ok) {
    const kind: TranscriptionFailure = response.status === 401 || response.status === 403
      ? 'unauthorized'
      : response.status === 429 ? 'rateLimited' : 'failed';
    throw new TranscriptionError(kind, `Groq answered ${response.status}`);
  }
  const body = await response.json() as { text?: unknown };
  if (typeof body.text !== 'string') throw new TranscriptionError('failed', 'Groq returned no text');
  return body.text.trim();
}

/**
 * Joins context hints, most relevant first, until the prompt window is full.
 * Byte-level BPE spends at most one token per byte; ASCII words merge into
 * far fewer, so they are counted at a third of their length.
 */
export function transcriptionPrompt(hints: readonly string[]): string {
  const encoder = new TextEncoder();
  const cost = (text: string) => {
    let ascii = 0;
    let other = 0;
    for (const character of text) {
      if (character.charCodeAt(0) < 0x80) ascii += 1;
      else other += encoder.encode(character).length;
    }
    return ascii / 3 + other;
  };
  const kept: string[] = [];
  let spent = 0;
  for (const hint of hints) {
    const next = cost(kept.length ? `, ${hint}` : hint);
    if (spent + next > PROMPT_TOKEN_BUDGET) break;
    kept.push(hint);
    spent += next;
  }
  return kept.join(', ');
}
