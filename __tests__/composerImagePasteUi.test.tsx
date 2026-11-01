import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Image, Text, TextInput } from 'react-native';

import type { ClipboardAttachmentResult, LocalAttachment } from '../src/services/attachmentPaste';
import type { UploadedComposerAttachment } from '../src/services/composerImagePaste';
import { Composer } from '../src/ui/chat/Composer';
import type { ComposerImageSource } from '../src/ui/chat/useComposerImages';
import { palettes } from '../src/ui/theme/tokens';

let pasteImage: ((picked: ClipboardAttachmentResult) => void) | null = null;
let pasteFailure: ((error: Error) => void) | null = null;

jest.mock('../src/services/voiceRecorder', () => {
  const { VoiceInput } = jest.requireActual('../src/services/voiceInput');
  return {
    createVoiceInput: () => new VoiceInput({
      recorder: { requestPermission: async () => 'granted', start: async () => {}, stop: async () => null, level: () => null },
      loadKey: async () => null,
      transcribe: async () => '',
      deleteFile: () => {},
      haptic: () => {},
    }),
  };
});
// The test renderer has no native views, so give the input a tag to bind.
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
  ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
  findNodeHandle: () => 42,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('react-native-reanimated', () => require('../test-support/reanimatedFade').reanimatedFadeMock);
jest.mock('react-native-whip-ssh/src/transcriptionContext', () => ({ transcriptionContext: jest.fn(() => []) }));

type Deferred = { resolve: (value: UploadedComposerAttachment | null) => void; reject: (error: Error) => void };

let root: ReactTestRenderer;
let onSend: jest.Mock;
let uploads: Deferred[];
let cancels: jest.Mock[];
let upload: jest.Mock<ReturnType<ComposerImageSource['upload']>, Parameters<ComposerImageSource['upload']>>;
let discard: jest.Mock;
let stages: Array<() => Promise<LocalAttachment>>;
let pick: jest.Mock<Promise<LocalAttachment | null>, ['photo' | 'camera']>;
let source: ComposerImageSource;

const texts = () => root.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
const button = (label: string) => root.root.findAll(node => node.props.accessibilityRole === 'button'
  && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => { await act(async () => { await button(label).props.onPress(); }); };
const sendDisabled = () => button('Send').props.disabled;
const typeText = async (value: string) => {
  await act(async () => { root.root.findAllByType(TextInput)[0].props.onChangeText(value); });
};
const paste = async (name = 'shot.png') => {
  await act(async () => { pasteImage?.({ uri: `file:///cache/${name}`, mimeType: 'image/png' }); });
};
const finishUpload = async (index: number, remotePath: string | null) => {
  await act(async () => {
    uploads[index].resolve(remotePath ? { remotePath, previewUri: `file:///preview/${index}.png`, dispose: jest.fn() } : null);
  });
};

const render = async (withImages = true) => {
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
        images={withImages ? source : undefined}
      />,
    );
  });
};

beforeEach(() => {
  onSend = jest.fn(() => Promise.resolve());
  uploads = [];
  cancels = [];
  stages = [];
  upload = jest.fn((stage: () => Promise<LocalAttachment>) => {
    stages.push(stage);
    const cancel = jest.fn();
    cancels.push(cancel);
    return { result: new Promise((resolve, reject) => { uploads.push({ resolve, reject }); }), cancel };
  });
  discard = jest.fn();
  pick = jest.fn(async (_from: 'photo' | 'camera'): Promise<LocalAttachment | null> => null);
  source = {
    upload,
    discard,
    pick,
    stagePasted: async picked => ({ name: 'shot.png', nativePath: picked.uri, previewUri: null, dispose: jest.fn() }),
    watch: (_tag, onPaste, onError) => {
      pasteImage = onPaste;
      pasteFailure = onError;
      return () => { pasteImage = null; pasteFailure = null; };
    },
  };
});
afterEach(() => { act(() => root.unmount()); });

it('sends a pasted image as its host path after the text', async () => {
  await render();
  await typeText('what is this');
  await paste();
  expect(sendDisabled()).toBe(true);
  await finishUpload(0, '/home/me/.whip/uploads/shot.png');
  expect(root.root.findAllByType(Image)[0].props.source).toEqual({ uri: 'file:///preview/0.png' });
  await press('Send');
  expect(onSend).toHaveBeenCalledWith('what is this', ['/home/me/.whip/uploads/shot.png']);
  expect(root.root.findAllByType(Image)).toHaveLength(0);
});

it('sends an image without any text', async () => {
  await render();
  await paste();
  await finishUpload(0, '/up/a.png');
  expect(sendDisabled()).toBe(false);
  await press('Send');
  expect(onSend).toHaveBeenCalledWith('', ['/up/a.png']);
});

it('drops an image the user removes, cancelling its upload', async () => {
  await render();
  await typeText('hi');
  await paste();
  await press('Remove image 1');
  expect(cancels[0]).toHaveBeenCalled();
  await finishUpload(0, '/up/late.png');
  await press('Send');
  expect(onSend).toHaveBeenCalledWith('hi', []);
});

it('reports a failed upload and keeps the draft sendable', async () => {
  await render();
  await typeText('hi');
  await paste();
  await act(async () => { uploads[0].reject(new Error('disk full')); });
  expect(texts()).toContain('Image not attached: disk full');
  expect(sendDisabled()).toBe(false);
});

it('reports a paste the native side could not read', async () => {
  await render();
  await act(async () => { pasteFailure?.(new Error('Could not paste the image')); });
  expect(texts()).toContain('Image not attached: Could not paste the image');
});

it('discards an image it cannot start uploading', async () => {
  upload.mockImplementation(() => { throw new Error('This pane is not connected.'); });
  await render();
  await paste();
  expect(discard).toHaveBeenCalledWith({ uri: 'file:///cache/shot.png', mimeType: 'image/png' });
  expect(texts()).toContain('Image not attached: This pane is not connected.');
});

it('stops watching for pastes when it unmounts', async () => {
  await render();
  expect(pasteImage).not.toBeNull();
  act(() => root.unmount());
  expect(pasteImage).toBeNull();
  await render();
});

it('takes no images where the screen gives it none', async () => {
  await render(false);
  expect(pasteImage).toBeNull();
});

const local = (name: string): LocalAttachment => ({ name, nativePath: `/cache/${name}`, previewUri: null, dispose: jest.fn() });

it('stages a pasted image as its upload begins', async () => {
  await render();
  await paste();
  await expect(stages[0]()).resolves.toMatchObject({ nativePath: 'file:///cache/shot.png' });
});

it('attaches a photo chosen from the + menu', async () => {
  const photo = local('photo.jpg');
  pick.mockResolvedValue(photo);
  await render();
  await press('Add photos or skills');
  await press('Attach a photo');
  expect(pick).toHaveBeenCalledWith('photo');
  await expect(stages[0]()).resolves.toBe(photo);
  await finishUpload(0, '/up/photo.jpg');
  await press('Send');
  expect(onSend).toHaveBeenCalledWith('', ['/up/photo.jpg']);
});

it('attaches nothing when the user backs out of the camera', async () => {
  await render();
  await press('Add photos or skills');
  await press('Take a photo');
  expect(pick).toHaveBeenCalledWith('camera');
  expect(upload).not.toHaveBeenCalled();
  expect(button('Take a photo')).toBeUndefined();
});

it('releases a chosen photo it cannot upload', async () => {
  const photo = local('photo.jpg');
  pick.mockResolvedValue(photo);
  upload.mockImplementation(() => { throw new Error('This pane is not connected.'); });
  await render();
  await press('Add photos or skills');
  await press('Attach a photo');
  expect(photo.dispose).toHaveBeenCalled();
  expect(texts()).toContain('Image not attached: This pane is not connected.');
});

it('reports a photo the picker could not provide', async () => {
  pick.mockRejectedValue(new Error('Camera permission was not granted'));
  await render();
  await press('Add photos or skills');
  await press('Take a photo');
  expect(texts()).toContain('Image not attached: Camera permission was not granted');
});

it('keeps skills behind the + menu', async () => {
  await render(false);
  expect(button('Claude skills')).toBeUndefined();
  await press('Add photos or skills');
  expect(button('Attach a photo')).toBeUndefined();
  expect(button('Claude skills')).toBeDefined();
});
