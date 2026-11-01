import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Switch, Text, TextInput } from 'react-native';
import { SpeechBackendSetting } from '../src/ui/hosts/SpeechBackendSetting';
import { SpeechVoicePicker } from '../src/ui/hosts/SpeechVoicePicker';
import { getSpeechPlayback, speechBackendCommand, systemSpeechVoices, type SpeechBackendStatus } from '../src/services/speechPlayback';
import { en } from '../src/locales/en';

jest.mock('../src/services/speechPlayback', () => ({
  getSpeechPlayback: jest.fn(), speechBackendCommand: jest.fn(), systemSpeechVoices: jest.fn(),
}));
jest.mock('../src/i18n', () => ({ deviceLanguage: () => 'en' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: keyof typeof en, values: Record<string, string> = {}) => {
    const copy = require('../src/locales/en').en[key] ?? key;
    return copy.replace(/{{(\w+)}}/g, (_: string, name: string) => values[name] ?? '');
  },
}) }));
jest.mock('../src/services/interactionFeedback', () => ({ hapticPress: (fn: () => void) => fn }));
jest.mock('../src/services/operationalDiagnostics', () => ({
  operationalErrorDetails: jest.fn(() => ({})), recordOperationalDiagnostic: jest.fn(),
}));

let root: ReactTestRenderer;
let status: SpeechBackendStatus;
let onChange: jest.Mock;
let speakPreview: jest.Mock;
let stopAnnouncement: jest.Mock;
const command = jest.mocked(speechBackendCommand);
const voices = jest.mocked(systemSpeechVoices);
const find = (label: string) => root.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => {
  expect(find(label)).toBeDefined();
  expect(find(label).props.disabled).not.toBe(true);
  await act(async () => { find(label).props.onPress(); });
};
const text = () => root.root.findAllByType(Text).map(node => node.props.children).join(' ');
const mount = async () => {
  await act(async () => { root = create(<SpeechBackendSetting ttsEnabled={false} onChange={onChange} />); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  status = {
    backend: 'system', voice: 'default', systemVoice: '', previewText: null, maxTextUnits: 5000,
    voices: [{ id: 'extra', name: 'Extra voice', language: 'en-GB', bytes: 256136, installed: false }],
    voiceDownload: null, supported: true, installed: false, downloading: false,
    downloadedBytes: 0, totalBytes: 65049306, requiredStorageBytes: 65049306, error: null, fallback: null,
  };
  onChange = jest.fn();
  speakPreview = jest.fn(() => new Promise(() => {}));
  stopAnnouncement = jest.fn(() => Promise.resolve());
  jest.mocked(getSpeechPlayback).mockReturnValue({ speakPreview, stopAnnouncement } as unknown as ReturnType<typeof getSpeechPlayback>);
  command.mockImplementation(async action => {
    if (action === 'phonon' || action === 'system') status = { ...status, backend: action };
    return status;
  });
  voices.mockResolvedValue([{ id: 'fr', name: 'French voice', language: 'fr-FR', networkRequired: true }]);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  jest.useRealTimers();
});

test('opens without downloading and changes the existing device announcement preference', async () => {
  await mount();
  expect(command.mock.calls).toEqual([['status']]);
  expect(find(en['speech.phonon']).props.disabled).toBe(true);
  await act(async () => root.root.findByType(Switch).props.onValueChange(true));
  expect(onChange).toHaveBeenCalledWith('ttsEnabled', true);
  await press(en['speech.download']);
  expect(command).toHaveBeenLastCalledWith('download');
});

test('selects system voices with their language and network metadata', async () => {
  await mount();
  await press(en['speech.systemVoice']);
  expect(text()).toContain('Requires a network connection.');
  await press('French voice');
  expect(command).toHaveBeenLastCalledWith('system-voice:fr');
});

test('selects Phonon and explicitly downloads or removes catalog voices', async () => {
  status = { ...status, installed: true };
  await mount();
  await press(en['speech.phonon']);
  await press(en['speech.phononVoice']);
  await press('Extra voice');
  expect(command).toHaveBeenLastCalledWith('voice:extra');
  status = { ...status, voices: [{ ...status.voices[0], installed: true }] };
  await press(en['speech.system']);
  await press(en['speech.phonon']);
  await press(en['speech.phononVoice']);
  await press('Remove Extra voice');
  expect(command).toHaveBeenLastCalledWith('remove-voice:extra');
});

test('polls downloads, permits cancellation, resumes partial data and removes it', async () => {
  status = { ...status, downloading: true, downloadedBytes: status.totalBytes / 2 };
  await mount();
  expect(text()).toContain('Downloading 50%');
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(command).toHaveBeenLastCalledWith('status');
  status = { ...status, downloading: false };
  await press(en['common.cancel']);
  expect(command).toHaveBeenLastCalledWith('cancel');
  await press(en['speech.resume']);
  expect(command).toHaveBeenLastCalledWith('download');
  await press(en['speech.remove']);
  expect(command).toHaveBeenLastCalledWith('delete');
});

test('saves exact preview text, stops on edit, disables blank previews and cleans up its owner', async () => {
  await mount();
  await act(async () => root.root.findByType(TextInput).props.onChangeText(' Bonjour "ami"\n'));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(command).toHaveBeenLastCalledWith(`preview-text:${JSON.stringify(' Bonjour "ami"\n')}`);
  await press(en['speech.preview']);
  const owner = speakPreview.mock.calls[0][0];
  expect(speakPreview).toHaveBeenCalledWith(owner, ' Bonjour "ami"\n', '');
  await act(async () => root.root.findByType(TextInput).props.onChangeText('  '));
  expect(stopAnnouncement).toHaveBeenCalledWith(owner);
  expect(find(en['speech.preview']).props.disabled).toBe(true);
  await act(async () => root.unmount());
  expect(command).toHaveBeenLastCalledWith('preview-text:"  "');
  expect(stopAnnouncement).toHaveBeenLastCalledWith(owner);
});

test('preserves a saved empty preview and reports unsupported devices and fallback', async () => {
  status = { ...status, previewText: '', supported: false, fallback: 'Model unavailable' };
  await mount();
  expect(root.root.findByType(TextInput).props.value).toBe('');
  expect(find(en['speech.preview']).props.disabled).toBe(true);
  expect(find(en['speech.download'])).toBeUndefined();
  expect(text()).toContain(en['speech.unsupported']);
  expect(text()).toContain('Model unavailable');
});

test('recovers from status and system voice enumeration failures', async () => {
  command.mockRejectedValueOnce(new Error('Status failed'));
  voices.mockRejectedValueOnce(new Error('Voices failed')).mockRejectedValueOnce(new Error('Voices failed'));
  await mount();
  expect(text()).toContain('Status failed');
  await press(en['speech.retry']);
  await press(en['speech.systemVoice']);
  expect(text()).toContain('Voices failed');
  await press(en['speech.retry']);
  expect(voices).toHaveBeenCalledTimes(3);
});

test('searches voice name, language and description and shows an empty result', async () => {
  const onSelect = jest.fn();
  await act(async () => {
    root = create(<SpeechVoicePicker title="Voice" selected="a" voices={[
      { id: 'a', name: 'Alice', language: 'en-US', description: 'Warm narrator' },
      { id: 'b', name: 'Bea', language: 'fr-FR' },
    ]} onSelect={onSelect} />);
  });
  await press('Voice');
  await act(async () => root.root.findByType(TextInput).props.onChangeText(' WARM '));
  expect(find('Alice')).toBeDefined();
  expect(find('Bea')).toBeUndefined();
  await act(async () => root.root.findByType(TextInput).props.onChangeText('fr-fr'));
  await press('Bea');
  expect(onSelect).toHaveBeenCalledWith('b');
  await press('Voice');
  await act(async () => root.root.findByType(TextInput).props.onChangeText('missing'));
  expect(text()).toContain(en['speech.noVoices']);
});

test('reports voice download progress, disables voice changes and polls through transient failures', async () => {
  status = { ...status, backend: 'phonon', installed: true,
    voiceDownload: { id: 'extra', downloadedBytes: 128068, totalBytes: 256136 } };
  await mount();
  expect(text()).toContain('Downloading Extra voice: 50%');
  expect(find(en['speech.phononVoice']).props.disabled).toBe(true);
  expect(find(en['speech.preview']).props.disabled).toBe(true);
  command.mockRejectedValueOnce(new Error('Temporary status error'));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(text()).toContain('Temporary status error');
  status = { ...status, voiceDownload: null };
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(find(en['speech.phononVoice']).props.disabled).toBe(false);
  expect(text()).not.toContain('Temporary status error');
});

test('preview respects native busy admission and uses the selected system voice language', async () => {
  status = { ...status, systemVoice: 'fr' };
  speakPreview.mockResolvedValue('busy');
  await mount();
  await press(en['speech.preview']);
  expect(speakPreview).toHaveBeenCalledWith(expect.any(String), en['speech.previewText'], 'fr-FR');
  expect(text()).toContain(en['speech.previewBusy']);
});

test('switching the backend stops the preview without stopping unrelated speech', async () => {
  status = { ...status, installed: true };
  await mount();
  await press(en['speech.preview']);
  const owner = speakPreview.mock.calls[0][0];
  await press(en['speech.phonon']);
  expect(stopAnnouncement).toHaveBeenCalledWith(owner);
  expect(find(en['speech.preview'])).toBeDefined();
});
