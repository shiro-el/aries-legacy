import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';

import { TranscriptionError } from '../src/services/groqTranscription';
import { VoiceInput, type VoiceRecorder } from '../src/services/voiceInput';
import { Composer, type ComposerVoice } from '../src/ui/chat/Composer';
import { palettes } from '../src/ui/theme/tokens';

class FakeRecorder implements VoiceRecorder {
  permission: 'granted' | 'denied' | 'blocked' = 'granted';
  async requestPermission() { return this.permission; }
  async start() {}
  async stop() { return 'file:///cache/Audio/voice-input-1.m4a'; }
  level() { return -12; }
}

let recorder: FakeRecorder;
let key: string | null;
let transcribe: jest.Mock;
let mockVoiceInput: VoiceInput;

jest.mock('../src/services/voiceRecorder', () => ({ createVoiceInput: () => mockVoiceInput }));
jest.mock('react-native-whip-ssh/src/transcriptionContext', () => ({
  transcriptionContext: jest.fn((draft: string, recent: string[]) => [draft, ...recent].filter(Boolean)),
}));

let root: ReactTestRenderer;
let onSend: jest.Mock;
let voice: ComposerVoice;

const texts = () => root.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
const findButton = (label: string) => root.root.findAll(node => node.props.accessibilityRole === 'button'
  && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => {
  const target = findButton(label);
  if (!target) throw new Error(`No button "${label}"; saw ${texts().join(' | ')}`);
  await act(async () => { await target.props.onPress(); });
};
const input = () => root.root.findAllByType(TextInput)[0];
const typeText = async (value: string, caret = value.length) => {
  await act(async () => {
    input().props.onChangeText(value);
    input().props.onSelectionChange({ nativeEvent: { selection: { start: caret, end: caret } } });
  });
};
const select = async (start: number, end: number) => {
  await act(async () => { input().props.onSelectionChange({ nativeEvent: { selection: { start, end } } }); });
};

const render = async (props: { voice?: ComposerVoice | null } = {}) => {
  await act(async () => {
    root = renderer.create(
      <Composer
        name="Claude"
        agent="claude"
        catalogSource={null}
        paneContext=""
        active
        disabled={false}
        palette={palettes.light}
        onSend={onSend}
        onOpenTerminal={jest.fn()}
        voice={props.voice === undefined ? voice : props.voice ?? undefined}
      />,
    );
  });
};

const dictate = async () => {
  await press('Record voice');
  await press('Stop recording');
};

beforeEach(() => {
  recorder = new FakeRecorder();
  key = 'gsk_key';
  transcribe = jest.fn(() => Promise.resolve('음성으로 쓴 글'));
  mockVoiceInput = new VoiceInput({
    recorder,
    loadKey: () => Promise.resolve(key),
    transcribe,
    deleteFile: jest.fn(),
    haptic: jest.fn(),
  });
  onSend = jest.fn(() => Promise.resolve());
  voice = { recentMessages: () => ['최근 메시지 WhipSsh'], onNeedKey: jest.fn() };
});
afterEach(() => { act(() => root.unmount()); });

it('has no microphone where the screen gives it no voice input', async () => {
  await render({ voice: null });
  expect(findButton('Record voice')).toBeUndefined();
});

it('replaces the input with a recording bar while recording', async () => {
  await render();
  await press('Record voice');
  expect(root.root.findAllByType(TextInput)).toHaveLength(0);
  expect(findButton('Cancel recording')).toBeDefined();
  expect(findButton('Stop recording')).toBeDefined();
  expect(texts().some(text => /^0:0\d$/.test(text))).toBe(true);
});

it('inserts the transcript at the caret and does not send it', async () => {
  await render();
  await typeText('앞 뒤', 2);
  await dictate();
  expect(input().props.value).toBe('앞 음성으로 쓴 글 뒤');
  expect(onSend).not.toHaveBeenCalled();
});

it('replaces the selected text with the transcript', async () => {
  await render();
  await typeText('keep REPLACE keep');
  await select(5, 12);
  await dictate();
  expect(input().props.value).toBe('keep 음성으로 쓴 글 keep');
});

it('passes context words from the draft and recent messages as the prompt', async () => {
  await render();
  await typeText('Composer');
  await dictate();
  expect(transcribe.mock.calls[0][0].prompt).toBe('Composer, 최근 메시지 WhipSsh');
});

it('sends the user to the key setting instead of recording without a key', async () => {
  key = null;
  await render();
  await press('Record voice');
  expect(input()).toBeDefined();
  await press('Set up Groq API key');
  expect(voice.onNeedKey).toHaveBeenCalled();
});

it('points to Android settings when the microphone is blocked', async () => {
  recorder.permission = 'blocked';
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await render();
  await press('Record voice');
  await press('Open Android settings');
  expect(openSettings).toHaveBeenCalled();
});

it('offers retry and discard after a failed transcription', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('rateLimited', '429'));
  await render();
  await dictate();
  expect(texts().join(' ')).toMatch(/rate limit/i);
  await press('Retry transcription');
  expect(input().props.value).toBe('음성으로 쓴 글');
});

it('discards a failed recording', async () => {
  transcribe.mockRejectedValueOnce(new TranscriptionError('network', 'offline'));
  await render();
  await dictate();
  await press('Discard recording');
  expect(findButton('Retry transcription')).toBeUndefined();
  expect(input().props.value).toBe('');
});

describe('polish', () => {
  let polish: jest.Mock;
  beforeEach(() => {
    polish = jest.fn(() => Promise.resolve('다듬은 글'));
    voice = { ...voice, polish };
  });

  it('offers polish for the latest transcript and replaces only that passage', async () => {
    await render();
    await typeText('앞 뒤', 2);
    await dictate();
    await press('Polish transcript');
    expect(polish).toHaveBeenCalledWith({ transcript: '음성으로 쓴 글', before: '앞 ', after: ' 뒤' });
    expect(input().props.value).toBe('앞 다듬은 글 뒤');
    expect(findButton('Polish transcript')).toBeUndefined();
  });

  it('restores the original transcript', async () => {
    await render();
    await dictate();
    await press('Polish transcript');
    await press('Restore original transcript');
    expect(input().props.value).toBe('음성으로 쓴 글');
    expect(findButton('Restore original transcript')).toBeUndefined();
    expect(findButton('Polish transcript')).toBeDefined();
  });

  it('keeps the offer when the user edits outside the passage', async () => {
    await render();
    await typeText('앞 ', 2);
    await dictate();
    await typeText('맨앞 앞 음성으로 쓴 글');
    await press('Polish transcript');
    expect(polish).toHaveBeenCalledWith({ transcript: '음성으로 쓴 글', before: '맨앞 앞 ', after: '' });
    expect(input().props.value).toBe('맨앞 앞 다듬은 글');
  });

  it('withdraws the offer when the user edits the passage', async () => {
    await render();
    await dictate();
    await typeText('음성으로 고친 글');
    expect(findButton('Polish transcript')).toBeUndefined();
  });

  it('withdraws restore when the user edits the polished passage', async () => {
    await render();
    await dictate();
    await press('Polish transcript');
    await typeText('다듬은 말');
    expect(findButton('Restore original transcript')).toBeUndefined();
  });

  it('treats typing right after the passage as an edit outside it', async () => {
    await render();
    await dictate();
    await typeText('음성으로 쓴 글. 그리고');
    await press('Polish transcript');
    expect(input().props.value).toBe('다듬은 글. 그리고');
  });

  it('withdraws the offer once the message is sent', async () => {
    await render();
    await dictate();
    await press('Send');
    expect(onSend).toHaveBeenCalledWith('음성으로 쓴 글');
    expect(findButton('Polish transcript')).toBeUndefined();
  });

  it('offers polish only for the newest transcript', async () => {
    transcribe.mockResolvedValueOnce('첫째').mockResolvedValueOnce('둘째');
    await render();
    await dictate();
    await dictate();
    await press('Polish transcript');
    expect(polish).toHaveBeenCalledWith({ transcript: '둘째', before: '첫째 ', after: '' });
  });

  it('keeps the original and shows a short error when polishing fails', async () => {
    const { PolishError } = jest.requireActual<typeof import('../src/services/transcriptPolish')>('../src/services/transcriptPolish');
    polish.mockRejectedValueOnce(new PolishError('timeout', 'slow'));
    await render();
    await dictate();
    await press('Polish transcript');
    expect(input().props.value).toBe('음성으로 쓴 글');
    expect(texts().join(' ')).toMatch(/30 seconds/);
    expect(findButton('Polish transcript')).toBeDefined();
  });

  it('drops a polish that returns after the user edited the passage', async () => {
    let finish: (text: string) => void = () => {};
    polish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await dictate();
    await press('Polish transcript');
    await typeText('음성으로 고친 글');
    await act(async () => { finish('다듬은 글'); });
    expect(input().props.value).toBe('음성으로 고친 글');
  });
});
