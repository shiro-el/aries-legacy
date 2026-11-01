const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const LANGUAGE = 'ko';
// Whisper reads at most 224 prompt tokens. Byte-level BPE never spends more
// than one token per UTF-8 byte, so a byte budget is a guaranteed bound.
const PROMPT_BYTE_BUDGET = 224;

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

/** Joins context hints, most relevant first, while the prompt fits Whisper's window. */
export function transcriptionPrompt(hints: readonly string[]): string {
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let spent = 0;
  for (const hint of hints) {
    const next = encoder.encode(kept.length ? `, ${hint}` : hint).length;
    if (spent + next > PROMPT_BYTE_BUDGET) break;
    kept.push(hint);
    spent += next;
  }
  return kept.join(', ');
}
