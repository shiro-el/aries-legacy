import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, type TextInput } from 'react-native';

import type { ClipboardAttachmentResult, LocalAttachment } from '../../services/attachmentPaste';
import type { UploadedComposerAttachment } from '../../services/composerImagePaste';

type TextInputHandle = React.ComponentRef<typeof TextInput>;

/** Where a composer's pasted images come from and go. */
export type ComposerImageSource = {
  /** Reports images pasted into the native input `tag`; returns a stop function. */
  watch: (tag: number, onPaste: (picked: ClipboardAttachmentResult) => void, onError: (error: Error) => void) => () => void;
  /** Lets the user choose a photo or take one; null when they back out. */
  pick: (from: ImageOrigin) => Promise<LocalAttachment | null>;
  /** Copies a pasted image into the app's cache, deleting the pasted file. */
  stagePasted: (picked: ClipboardAttachmentResult) => Promise<LocalAttachment>;
  /** Deletes a pasted image that will not be staged. */
  discard: (picked: ClipboardAttachmentResult) => void;
  /** Uploads the image `stage` prepares to the pane's host and owns it from then on. Throws while offline. */
  upload: (stage: () => Promise<LocalAttachment>) => {
    result: Promise<UploadedComposerAttachment | null>;
    cancel: () => void;
  };
};

export type ImageOrigin = 'photo' | 'camera';

/** An image in the draft; `remotePath` is null until its upload finishes. */
export type ComposerImage = { id: number; previewUri: string | null; remotePath: string | null };

type Entry = ComposerImage & { cancel: () => void; dispose: (() => void) | null };

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Images pasted into a draft, uploaded as they arrive and sent as their host paths. */
export function useComposerImages(source: ComposerImageSource | undefined, onError: (message: string) => void) {
  const entries = useRef<Entry[]>([]);
  const sequence = useRef(0);
  const [images, setImages] = useState<readonly ComposerImage[]>([]);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const publish = useCallback(
    () => setImages(entries.current.map(({ id, previewUri, remotePath }) => ({ id, previewUri, remotePath }))),
    [],
  );
  const drop = useCallback((entry: Entry) => {
    entries.current = entries.current.filter(candidate => candidate !== entry);
    publish();
  }, [publish]);

  useEffect(() => () => {
    for (const entry of entries.current) {
      entry.cancel();
      entry.dispose?.();
    }
    entries.current = [];
  }, []);

  /** `abandon` releases the image when its upload cannot start. */
  const start = useCallback((stage: () => Promise<LocalAttachment>, abandon: () => void) => {
    if (!source) return;
    let started: ReturnType<ComposerImageSource['upload']>;
    try {
      started = source.upload(stage);
    } catch (error) {
      abandon();
      errorRef.current(`Image not attached: ${reason(error)}`);
      return;
    }
    const entry: Entry = { id: ++sequence.current, previewUri: null, remotePath: null, cancel: started.cancel, dispose: null };
    entries.current = [...entries.current, entry];
    publish();
    started.result.then(uploaded => {
      const kept = entries.current.includes(entry);
      if (!uploaded || !kept) {
        uploaded?.dispose();
        if (kept) drop(entry);
        return;
      }
      entry.remotePath = uploaded.remotePath;
      entry.previewUri = uploaded.previewUri;
      entry.dispose = uploaded.dispose;
      publish();
    }, (error: unknown) => {
      if (!entries.current.includes(entry)) return;
      drop(entry);
      errorRef.current(`Image not attached: ${reason(error)}`);
    });
  }, [source, publish, drop]);

  const addPasted = useCallback((picked: ClipboardAttachmentResult) => {
    if (!source) return;
    start(() => source.stagePasted(picked), () => source.discard(picked));
  }, [source, start]);

  const pick = async (from: ImageOrigin) => {
    if (!source) return;
    let local: LocalAttachment | null;
    try {
      local = await source.pick(from);
    } catch (error) {
      errorRef.current(`Image not attached: ${reason(error)}`);
      return;
    }
    if (!local) return;
    const picked = local;
    start(() => Promise.resolve(picked), () => picked.dispose());
  };

  const remove = (id: number) => {
    const entry = entries.current.find(candidate => candidate.id === id);
    if (!entry) return;
    entry.cancel();
    entry.dispose?.();
    drop(entry);
  };

  /** The host keeps the uploaded copies; only the local previews go. */
  const clear = () => {
    for (const entry of entries.current) entry.dispose?.();
    entries.current = [];
    publish();
  };

  const paths = images.flatMap(image => (image.remotePath ? [image.remotePath] : []));
  return { images, paths, uploading: paths.length < images.length, addPasted, pick, remove, clear };
}

/** Routes images pasted into one text input, from the clipboard or the keyboard. */
export function useImagePaste(
  source: ComposerImageSource | undefined,
  onPaste: (picked: ClipboardAttachmentResult) => void,
  onError: (message: string) => void,
) {
  const input = useRef<TextInputHandle | null>(null);
  const handlers = useRef({ onPaste, onError });
  handlers.current = { onPaste, onError };
  const binding = useRef<{ tag: number; stop: () => void } | null>(null);

  // The native view exists only after layout, and a remounted input has a new tag.
  const connect = useCallback(() => {
    if (!source) return;
    const tag = findNodeHandle(input.current);
    if (tag == null || binding.current?.tag === tag) return;
    binding.current?.stop();
    binding.current = {
      tag,
      stop: source.watch(
        tag,
        picked => handlers.current.onPaste(picked),
        error => handlers.current.onError(`Image not attached: ${error.message}`),
      ),
    };
  }, [source]);

  useEffect(() => {
    connect();
    return () => {
      binding.current?.stop();
      binding.current = null;
    };
  }, [connect]);

  return { ref: input, onLayout: connect };
}
