import { AppState, NativeModules, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  BrowserRegistry,
  type BrowserSessionIdentity,
} from '../src/browser/registry';

const identity: BrowserSessionIdentity = {
  runtimeId: 'host',
  sessionId: 'agent',
  paneId: 'pane',
  terminalId: 'terminal',
  shizukuAccess: true,
};
const diagnostics = {
  status: 'ready',
  authorized: true,
  backend: 'shizuku',
  uid: 2000,
  server_version: 13,
};
const output = {
  uid: 2000,
  exit_code: 0,
  stdout: 'uid=2000(shell)\n',
  stderr: '',
  truncated: false,
  timed_out: false,
};
const privileged = {
  diagnostics: jest.fn(async () => diagnostics),
  execute: jest.fn(async () => JSON.stringify(output)),
};
const previous = {
  platform: Platform.OS,
  state: AppState.currentState,
  shizuku: NativeModules.WhipShizuku,
  device: NativeModules.WhipDevice,
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  AppState.currentState = 'background';
  NativeModules.WhipShizuku = privileged;
  NativeModules.WhipDevice = { location: jest.fn() };
});
afterEach(() => {
  Platform.OS = previous.platform;
  AppState.currentState = previous.state;
  NativeModules.WhipShizuku = previous.shizuku;
  NativeModules.WhipDevice = previous.device;
});

async function call(action: string, shizukuAccess = true) {
  const runtime = {
    runtimeId: identity.runtimeId,
    startWebPreview: jest.fn(),
    stopPreview: jest.fn(),
    reverseControlSessions: () => [{ ...identity, shizukuAccess }],
    reverseControlReply: jest.fn(),
  };
  await new BrowserRegistry().event(
    {
      session: identity,
      kind: 'action',
      requestId: 'request',
      action,
      argumentsJson: JSON.stringify({
        argv: ['/system/bin/id'],
        timeout_ms: 1000,
        max_output_bytes: 1024,
        text: 'clipboard',
        max_chars: 100,
        sensor: 'accelerometer',
      }),
    },
    runtime,
  );
  expect(runtime.reverseControlReply).toHaveBeenCalledTimes(1);
  expect(runtime.reverseControlReply).toHaveBeenCalledWith(
    'agent',
    'request',
    expect.any(String),
  );
  return JSON.parse(runtime.reverseControlReply.mock.calls[0][2]) as unknown;
}

test.each([
  ['device.shizuku_status', diagnostics],
  ['device.shizuku_exec', output],
])('%s replies while Android is backgrounded', async (action, value) => {
  expect(await call(action)).toEqual({ ok: true, value });
  if (action === 'device.shizuku_exec')
    expect(privileged.execute).toHaveBeenCalledWith(
      'agent',
      'agent:request',
      ['/system/bin/id'],
      1000,
      1024,
    );
});

test.each([
  ['device.shizuku_status', diagnostics],
  ['device.shizuku_exec', output],
])('%s needs no per-session grant', async (action, value) => {
  expect(await call(action, false)).toEqual({ ok: true, value });
});

test.each([
  'device.clipboard_read',
  'device.clipboard_write',
  'device.location',
  'device.motion',
  'device.sensor_snapshot',
])('%s retains its foreground requirement', async action => {
  expect(await call(action)).toMatchObject({
    ok: false,
    error: {
      code: 'device_unavailable',
      message: expect.stringContaining('foregrounded'),
    },
  });
  expect(Clipboard.getString).not.toHaveBeenCalled();
  expect(Clipboard.setString).not.toHaveBeenCalled();
  expect(NativeModules.WhipDevice.location).not.toHaveBeenCalled();
});
