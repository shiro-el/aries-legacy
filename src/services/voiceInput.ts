import { TranscriptionError, type TranscriptionFailure, type TranscriptionRequest } from './groqTranscription';

/** Groq's free tier takes 25 MB; ten minutes of 16 kHz mono AAC is about 5 MB. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

export type MicrophonePermission = 'granted' | 'denied' | 'blocked';

/** The platform microphone. One recording at a time. */
export interface VoiceRecorder {
  requestPermission(): Promise<MicrophonePermission>;
  start(): Promise<void>;
  /** Ends the recording and returns its file, or null when nothing was written. */
  stop(): Promise<string | null>;
  /** Input level in dBFS while recording. */
  level(): number | null;
}

export interface VoiceInputDependencies {
  recorder: VoiceRecorder;
  loadKey: () => Promise<string | null>;
  transcribe: (request: TranscriptionRequest) => Promise<string>;
  deleteFile: (uri: string) => void;
  haptic: () => void;
  /** Read-aloud must release the audio session before the microphone opens. */
  microphone?: (active: boolean) => Promise<void> | void;
}

export type VoiceInputSnapshot =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'transcribing' }
  | { phase: 'failed'; error: TranscriptionFailure };

export type StartResult =
  | 'started'
  | 'busy'
  | 'noKey'
  | 'permissionDenied'
  | 'permissionBlocked'
  | 'recordingFailed';

type Request = { prompt: string; onText: (text: string) => void };

const IDLE: VoiceInputSnapshot = { phase: 'idle' };

/**
 * Tap to record, tap to stop, then one transcription. A failed transcription
 * keeps its recording, and only that one, until it is retried or discarded.
 */
export class VoiceInput {
  private snapshot: VoiceInputSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private request: Request | null = null;
  private kept: string | null = null;
  private limit: ReturnType<typeof setTimeout> | null = null;
  // Bumped when the composer goes away; a transcription from before is dropped.
  private generation = 0;

  constructor(private readonly deps: VoiceInputDependencies) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): VoiceInputSnapshot => this.snapshot;

  level(): number | null {
    return this.snapshot.phase === 'recording' ? this.deps.recorder.level() : null;
  }

  async start(request: Request): Promise<StartResult> {
    if (this.snapshot.phase === 'recording' || this.snapshot.phase === 'transcribing') return 'busy';
    if (!await this.deps.loadKey()) return 'noKey';
    const permission = await this.deps.recorder.requestPermission();
    if (permission === 'denied') return 'permissionDenied';
    if (permission === 'blocked') return 'permissionBlocked';
    this.forget();
    try {
      await this.deps.microphone?.(true);
      await this.deps.recorder.start();
    } catch {
      await this.deps.microphone?.(false);
      this.publish(IDLE);
      return 'recordingFailed';
    }
    this.request = request;
    this.deps.haptic();
    this.limit = setTimeout(() => { void this.stop(); }, MAX_RECORDING_MS);
    this.publish({ phase: 'recording', startedAt: Date.now() });
    return 'started';
  }

  async stop(): Promise<void> {
    if (this.snapshot.phase !== 'recording') return;
    this.publish({ phase: 'transcribing' });
    const uri = await this.release();
    this.deps.haptic();
    if (!uri) {
      this.publish(IDLE);
      return;
    }
    this.kept = uri;
    await this.transcribe();
  }

  async cancel(): Promise<void> {
    if (this.snapshot.phase !== 'recording') return;
    this.publish(IDLE);
    const uri = await this.release();
    if (uri) this.deps.deleteFile(uri);
    this.request = null;
  }

  async retry(): Promise<void> {
    if (this.snapshot.phase !== 'failed' || !this.kept) return;
    this.publish({ phase: 'transcribing' });
    await this.transcribe();
  }

  discard(): void {
    if (this.snapshot.phase !== 'failed') return;
    this.forget();
    this.request = null;
    this.publish(IDLE);
  }

  /** The composer is gone: stop listening, keep nothing, drop late results. */
  dispose(): void {
    this.generation += 1;
    if (this.snapshot.phase === 'recording') void this.cancel();
    else if (this.snapshot.phase === 'failed') this.discard();
    else if (this.snapshot.phase === 'transcribing') this.publish(IDLE);
  }

  private async release(): Promise<string | null> {
    if (this.limit) clearTimeout(this.limit);
    this.limit = null;
    try {
      return await this.deps.recorder.stop();
    } catch {
      return null;
    } finally {
      await this.deps.microphone?.(false);
    }
  }

  private async transcribe(): Promise<void> {
    const uri = this.kept;
    const request = this.request;
    if (!uri || !request) return;
    const generation = this.generation;
    try {
      const apiKey = await this.deps.loadKey();
      if (!apiKey) throw new TranscriptionError('unauthorized', 'No Groq API key');
      const text = await this.deps.transcribe({ uri, apiKey, prompt: request.prompt });
      if (generation !== this.generation) {
        if (this.kept === uri) this.forget();
        return;
      }
      this.forget();
      this.request = null;
      if (text) request.onText(text);
      this.publish(IDLE);
    } catch (cause) {
      if (generation !== this.generation) {
        if (this.kept === uri) this.forget();
        return;
      }
      this.publish({ phase: 'failed', error: cause instanceof TranscriptionError ? cause.kind : 'failed' });
    }
  }

  private forget(): void {
    if (this.kept) this.deps.deleteFile(this.kept);
    this.kept = null;
  }

  private publish(next: VoiceInputSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
