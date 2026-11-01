import { TranscriptionError } from '../src/services/groqTranscription';
import {
  MAX_RECORDING_MS,
  VoiceInput,
  type VoiceInputDependencies,
  type VoiceRecorder,
} from '../src/services/voiceInput';

class FakeRecorder implements VoiceRecorder {
  permission: 'granted' | 'denied' | 'blocked' = 'granted';
  recording = false;
  count = 0;
  failStart = false;
  async requestPermission() { return this.permission; }
  async start() {
    if (this.failStart) throw new Error('mic busy');
    this.recording = true;
    this.count += 1;
  }
  async stop() {
    this.recording = false;
    return `file:///cache/Audio/voice-input-${this.count}.m4a`;
  }
  level() { return this.recording ? -20 : null; }
}

let recorder: FakeRecorder;
let key: string | null;
let transcribe: jest.Mock;
let deleted: string[];
let input: VoiceInput;
let inserted: string[];

const flush = () => new Promise(resolve => jest.requireActual<typeof globalThis>('timers').setImmediate(resolve));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  recorder = new FakeRecorder();
  key = 'gsk_key';
  transcribe = jest.fn(() => Promise.resolve('받아쓴 글'));
  deleted = [];
  inserted = [];
  const dependencies: VoiceInputDependencies = {
    recorder,
    loadKey: () => Promise.resolve(key),
    transcribe,
    deleteFile: uri => { deleted.push(uri); },
    haptic: jest.fn(),
  };
  input = new VoiceInput(dependencies);
});
afterEach(() => { jest.useRealTimers(); });

const start = () => input.start({ prompt: 'WhipSsh', onText: text => { inserted.push(text); } });

it('records, then transcribes once on stop and hands the text back without sending', async () => {
  expect(await start()).toBe('started');
  expect(input.getSnapshot().phase).toBe('recording');
  expect(recorder.recording).toBe(true);
  const stopped = input.stop();
  expect(input.getSnapshot().phase).toBe('transcribing');
  await stopped;
  expect(transcribe).toHaveBeenCalledWith({ uri: 'file:///cache/Audio/voice-input-1.m4a', apiKey: 'gsk_key', prompt: 'WhipSsh' });
  expect(inserted).toEqual(['받아쓴 글']);
  expect(input.getSnapshot().phase).toBe('idle');
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
});

it('does not record without a key', async () => {
  key = null;
  expect(await start()).toBe('noKey');
  expect(recorder.recording).toBe(false);
  expect(input.getSnapshot().phase).toBe('idle');
});

it('does not record without microphone permission', async () => {
  recorder.permission = 'blocked';
  expect(await start()).toBe('permissionBlocked');
  recorder.permission = 'denied';
  expect(await start()).toBe('permissionDenied');
  expect(recorder.recording).toBe(false);
});

it('reports a microphone that will not start', async () => {
  recorder.failStart = true;
  expect(await start()).toBe('recordingFailed');
  expect(input.getSnapshot().phase).toBe('idle');
});

it('cancelling a recording deletes it and transcribes nothing', async () => {
  await start();
  await input.cancel();
  expect(transcribe).not.toHaveBeenCalled();
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
  expect(input.getSnapshot().phase).toBe('idle');
});

it('stops and transcribes by itself at ten minutes', async () => {
  await start();
  jest.advanceTimersByTime(MAX_RECORDING_MS - 1);
  expect(input.getSnapshot().phase).toBe('recording');
  jest.advanceTimersByTime(1);
  await flush();
  await flush();
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(inserted).toEqual(['받아쓴 글']);
});

it.each([
  ['unauthorized'],
  ['rateLimited'],
  ['network'],
  ['failed'],
] as const)('keeps the recording when transcription fails with %s, then retries it', async kind => {
  transcribe.mockRejectedValueOnce(new TranscriptionError(kind, 'x'));
  await start();
  await input.stop();
  expect(input.getSnapshot()).toEqual({ phase: 'failed', error: kind });
  expect(deleted).toEqual([]);
  await input.retry();
  expect(transcribe).toHaveBeenCalledTimes(2);
  expect(transcribe.mock.calls[1][0].uri).toBe('file:///cache/Audio/voice-input-1.m4a');
  expect(inserted).toEqual(['받아쓴 글']);
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
});

it('retries with the key saved after a rejected one', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('unauthorized', 'x'));
  await start();
  await input.stop();
  key = 'gsk_fixed';
  await input.retry();
  expect(transcribe.mock.calls[1][0].apiKey).toBe('gsk_fixed');
});

it('discarding a failed recording deletes it', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('network', 'x'));
  await start();
  await input.stop();
  input.discard();
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
  expect(input.getSnapshot().phase).toBe('idle');
});

it('keeps only the latest failed recording', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('network', 'x'));
  await start();
  await input.stop();
  await start();
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
  await input.stop();
  expect(inserted).toEqual(['받아쓴 글']);
});

it('ignores empty transcripts', async () => {
  transcribe.mockResolvedValueOnce('');
  await start();
  await input.stop();
  expect(inserted).toEqual([]);
  expect(input.getSnapshot().phase).toBe('idle');
});

it('buzzes on start and stop', async () => {
  const haptic = jest.fn();
  input = new VoiceInput({ recorder, loadKey: () => Promise.resolve(key), transcribe, deleteFile: () => {}, haptic });
  await start();
  await input.stop();
  expect(haptic).toHaveBeenCalledTimes(2);
});

it('drops a result that arrives after the composer goes away', async () => {
  let finish: (text: string) => void = () => {};
  transcribe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await start();
  const stopped = input.stop();
  await flush();
  expect(transcribe).toHaveBeenCalled();
  input.dispose();
  finish('late');
  await stopped;
  expect(inserted).toEqual([]);
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
});

it('ignores a second tap while the microphone is still opening', async () => {
  const first = start();
  const second = start();
  expect(await second).toBe('busy');
  expect(await first).toBe('started');
  expect(recorder.count).toBe(1);
});

it('does not open the microphone for a composer that went away during the permission prompt', async () => {
  let grant: (value: 'granted') => void = () => {};
  recorder.requestPermission = () => new Promise(resolve => { grant = resolve; });
  const started = start();
  await flush();
  input.dispose();
  grant('granted');
  expect(await started).toBe('busy');
  expect(recorder.recording).toBe(false);
  expect(input.getSnapshot().phase).toBe('idle');
});

it('drops a recording whose composer went away while it was stopping', async () => {
  let finishStop: (uri: string) => void = () => {};
  await start();
  recorder.stop = () => new Promise(resolve => { finishStop = resolve; });
  const stopped = input.stop();
  input.dispose();
  finishStop('file:///cache/Audio/voice-input-1.m4a');
  await stopped;
  expect(transcribe).not.toHaveBeenCalled();
  expect(inserted).toEqual([]);
  expect(deleted).toEqual(['file:///cache/Audio/voice-input-1.m4a']);
});

it('finishes releasing a cancelled recording before the next one opens the microphone', async () => {
  const events: string[] = [];
  const microphone = jest.fn((active: boolean) => { events.push(active ? 'open' : 'close'); });
  input = new VoiceInput({ recorder, loadKey: () => Promise.resolve(key), transcribe, deleteFile: () => {}, haptic: jest.fn(), microphone });
  await start();
  let finishStop: (uri: string) => void = () => {};
  recorder.stop = () => new Promise(resolve => { finishStop = resolve; });
  const cancelled = input.cancel();
  const next = start();
  await flush();
  expect(events).toEqual(['open']);
  finishStop('file:///cache/Audio/voice-input-1.m4a');
  await cancelled;
  expect(await next).toBe('started');
  expect(events).toEqual(['open', 'close', 'open']);
  expect(input.getSnapshot().phase).toBe('recording');
});

it('keeps a failed recording when the composer leaves the screen', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('unauthorized', 'x'));
  await start();
  await input.stop();
  input.pause();
  expect(input.getSnapshot()).toEqual({ phase: 'failed', error: 'unauthorized' });
  expect(deleted).toEqual([]);
});

it('closes the microphone when the composer leaves the screen', async () => {
  await start();
  input.pause();
  await flush();
  expect(recorder.recording).toBe(false);
  expect(transcribe).not.toHaveBeenCalled();
});
