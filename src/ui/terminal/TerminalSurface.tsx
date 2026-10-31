import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { NativeTerminalInput, type NativeTerminalInputHandle } from 'expo-whip-terminal-input';
import type { RuntimeTerminalGeometry } from 'react-native-whip-ssh';

import { arrayBufferToBase64 } from '../../lib/base64';
import type { TerminalControlEvent, TerminalOutput } from '../../lib/terminalBridge';
import type { TerminalAttachmentId } from '../../services/TerminalBridgeController';
import { nativeTerminalInputWrites, type TerminalRenderTarget } from '../../lib/terminalRenderer';
import { reportBackgroundFailure } from '../../services/backgroundOperations';
import type { TerminalSessionStatus } from '../../terminalSessions';

const TERMINAL_URI = 'file:///android_asset/herdr-terminal.html';

export type TerminalSurfaceHandle = {
  /** Sends bytes to the remote pane as if typed. */
  send: (data: string) => void;
  showKeyboard: () => void;
  hideKeyboard: () => void;
  /** Whether the remote program asked for application cursor keys (DECCKM). */
  applicationCursorKeys: () => boolean;
  /** Tells the keyboard a modifier is latched, so each key arrives on its own. */
  setModifierLatched: (latched: boolean) => void;
};

type Props = {
  target: TerminalRenderTarget;
  fontSize: number;
  background: string;
  onStatus: (status: TerminalSessionStatus, error?: string) => void;
  /** Lets the screen rewrite typed keys, e.g. for a latched Ctrl. */
  transformInput?: (data: string) => string;
  /** A short tap on the terminal that did not move or turn into a long press. */
  onTap?: () => void;
};

type WebMessage =
  | { type: 'ready'; key?: undefined }
  | { type: 'terminal-ready'; key: string }
  | { type: 'resize'; key: string; cols: number; rows: number; cellWidthPx?: number; cellHeightPx?: number }
  | { type: 'input'; key: string; data: string }
  | { type: 'open-link'; key: string; link: string }
  | { type: 'keyboard-modes'; key: string; applicationCursorKeys: boolean }
  | { type: typeof TAP_MESSAGE; key?: undefined }
  | { type: string; key?: string };

let identityCounter = 0;

const TAP_MESSAGE = 'aries-tap';
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 400;

// Reports taps from the page without touching its own touch handling, which
// scrolls, selects and clicks. Listeners are passive and run in the capture
// phase, so they see the touch before the page can stop it.
const TAP_SCRIPT = `(() => {
  if (window.__ariesTap) return;
  window.__ariesTap = true;
  let start = null;
  const options = { capture: true, passive: true };
  window.addEventListener('touchstart', event => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    start = touch ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
  }, options);
  window.addEventListener('touchmove', event => {
    const touch = event.touches[0];
    if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > ${TAP_SLOP_PX}) start = null;
  }, options);
  window.addEventListener('touchcancel', () => { start = null; }, options);
  window.addEventListener('touchend', () => {
    const began = start;
    start = null;
    if (began && Date.now() - began.time <= ${TAP_MAX_MS}) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${TAP_MESSAGE}' }));
    }
  }, options);
})();
true;`;

/**
 * One Herdr pane rendered by the bundled xterm page. Frames arrive over the
 * JavaScript bridge path of TerminalBridgeController; typing goes through the
 * native input view, because xterm's own textarea is read-only on Android.
 */
export const TerminalSurface = forwardRef<TerminalSurfaceHandle, Props>(function TerminalSurfaceView(
  { target, fontSize, background, onStatus, transformInput, onTap },
  ref,
) {
  const web = useRef<WebView>(null);
  const input = useRef<NativeTerminalInputHandle>(null);
  const key = target.key;
  const terminalId = target.session.terminalId;
  const client = target.client;
  const identity = useMemo(() => `${key}#${++identityCounter}`, [key]);
  const geometry = useRef<RuntimeTerminalGeometry | null>(null);
  const attached = useRef(false);
  const attachment = useRef<TerminalAttachmentId | null>(null);
  const queue = useRef<string[]>([]);
  const flushScheduled = useRef(false);
  const utf8Sequence = useRef(-1);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const transformRef = useRef(transformInput);
  transformRef.current = transformInput;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const applicationCursorKeys = useRef(false);

  const run = useCallback((script: string) => {
    queue.current.push(script);
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    setTimeout(() => {
      flushScheduled.current = false;
      const body = queue.current.join('\n');
      queue.current = [];
      web.current?.injectJavaScript(`${body}\ntrue;`);
    }, 0);
  }, []);

  const call = useCallback(
    (method: string, ...args: unknown[]) => {
      const list = [key, ...args].map(value => JSON.stringify(value ?? null)).join(',');
      run(`window.${method} && window.${method}(${list});`);
    },
    [key, run],
  );

  const write = useCallback(
    (data: string) => {
      client.terminal.writeToTerminal(terminalId, data).catch((error: unknown) => {
        onStatusRef.current('error', String(error));
      });
    },
    [client, terminalId],
  );

  const onFrame = useCallback(
    (frame: TerminalOutput) => {
      if (frame.type === 'terminal.graphics') {
        const bytes = typeof frame.bytes === 'string' ? frame.bytes : arrayBufferToBase64(frame.bytes);
        call('herdrWriteBase64Chunk', utf8Sequence.current--, bytes, true);
        return;
      }
      if (frame.encoding === 'ansi') {
        const bytes = typeof frame.bytes === 'string' ? frame.bytes : arrayBufferToBase64(frame.bytes);
        call('herdrWriteBase64Chunk', frame.seq, bytes, frame.final !== false);
        return;
      }
      if (typeof frame.bytes === 'string') call('herdrWrite', frame.bytes);
      else call('herdrWriteBase64Chunk', utf8Sequence.current--, arrayBufferToBase64(frame.bytes), true);
    },
    [call],
  );

  const onControl = useCallback(
    (event: TerminalControlEvent) => {
      if (event.type === 'mouse-capture') call('herdrSetApplicationMouseCapture', event.enabled);
      if (event.type === 'protocol-state') input.current?.kittyKeyboard(event.state.kittyKeyboardReportAll);
    },
    [call],
  );

  const attach = useCallback(() => {
    if (attached.current) return;
    attached.current = true;
    onStatusRef.current('connecting');
    client.terminal
      .openTerminal(
        terminalId,
        onFrame,
        reason => {
          attached.current = false;
          onStatusRef.current('disconnected', reason);
        },
        onControl,
        geometry.current ?? undefined,
      )
      .then(id => {
        attachment.current = id;
        onStatusRef.current('connected');
      })
      .catch((error: unknown) => {
        attached.current = false;
        onStatusRef.current('error', String(error));
      });
  }, [client, onControl, onFrame, terminalId]);

  // Herdr sizes a pane to its one attached client and gives the size back to
  // the computer only when that client lets go, so leaving the screen
  // releases the pane instead of keeping it at the phone's width.
  useEffect(() => () => {
    const id = attachment.current;
    attachment.current = null;
    attached.current = false;
    if (id) client.terminal.releaseTerminal(terminalId, id);
  }, [client, terminalId]);

  useEffect(() => {
    call('herdrConfigure', { fontSize, scrollback: 5000, cursorBlink: true, doubleTapAction: 'tab' });
  }, [call, fontSize]);

  useImperativeHandle(ref, () => ({
    send: write,
    showKeyboard: () => {
      input.current?.setEnabled(true);
      input.current?.focus();
    },
    hideKeyboard: () => input.current?.blur(),
    applicationCursorKeys: () => applicationCursorKeys.current,
    setModifierLatched: latched => input.current?.modifiedInput(latched),
  }), [write]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: WebMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as WebMessage;
    } catch {
      return;
    }
    if (message.type === 'ready' && message.key === undefined) {
      call('herdrCreate', identity);
      call('herdrConfigure', { fontSize, scrollback: 5000, cursorBlink: true, doubleTapAction: 'tab' });
      call('herdrActivate');
      return;
    }
    if (message.type === TAP_MESSAGE) {
      onTapRef.current?.();
      return;
    }
    if (message.key !== key) return;
    switch (message.type) {
      case 'terminal-ready':
        attach();
        return;
      case 'resize': {
        const { cols, rows, cellWidthPx = 0, cellHeightPx = 0 } = message as Extract<WebMessage, { type: 'resize' }>;
        if (!(cols > 0 && rows > 0)) return;
        geometry.current = { columns: cols, rows, cellWidthPx, cellHeightPx };
        if (attached.current) {
          reportBackgroundFailure(
            client.terminal.resizeTerminal(terminalId, cols, rows, cellWidthPx, cellHeightPx),
            'terminal-resize',
          );
        }
        return;
      }
      case 'input':
        write((message as Extract<WebMessage, { type: 'input' }>).data);
        return;
      case 'keyboard-modes': {
        const { applicationCursorKeys: application } = message as Extract<WebMessage, { type: 'keyboard-modes' }>;
        applicationCursorKeys.current = application;
        input.current?.cursorKeys(application);
        return;
      }
      case 'open-link':
        reportBackgroundFailure(
          Linking.openURL((message as Extract<WebMessage, { type: 'open-link' }>).link),
          'terminal-open-link',
        );
        return;
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: background }]}>
      <WebView
        ref={web}
        source={{ uri: TERMINAL_URI }}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        javaScriptEnabled
        onMessage={onMessage}
        injectedJavaScript={TAP_SCRIPT}
        style={[styles.fill, { backgroundColor: background }]}
        containerStyle={{ backgroundColor: background }}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        setSupportMultipleWindows={false}
        textZoom={100}
      />
      <NativeTerminalInput
        ref={input}
        binding={identity}
        onTerminalInput={event => {
          const data = event.nativeEvent.data;
          if (!data) return;
          for (const part of nativeTerminalInputWrites(data)) {
            write(transformRef.current ? transformRef.current(part) : part);
          }
        }}
        onCommandError={() => undefined}
      />
    </View>
  );
});

const styles = StyleSheet.create({ fill: { flex: 1 } });
