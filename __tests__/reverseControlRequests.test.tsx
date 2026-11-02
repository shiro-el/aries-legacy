import { act, create } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';

const mockSubscribe = jest.fn();
jest.mock('react-native-whip-ssh', () => ({
  subscribeReverseControlEvents: (...args: unknown[]) => mockSubscribe(...args),
}));
jest.mock('../src/browser/native', () => ({ supportsBrowserControl: () => true }));
const mockRegistry = {
  event: jest.fn(),
  loadArchive: jest.fn(() => Promise.resolve()),
  registerRuntimes: jest.fn(),
  reconcile: jest.fn(),
  closeHost: jest.fn(() => Promise.resolve()),
  entries: new Map(),
};
jest.mock('../src/browser/registry', () => ({ get browserRegistry() { return mockRegistry; } }));

import { useReverseControlRequests } from '../src/browser/useReverseControlRequests';
import type { BrowserRuntime } from '../src/browser/registry';

function Probe({ runtimes }: { runtimes: readonly BrowserRuntime[] }) {
  useReverseControlRequests(runtimes);
  return null;
}

const runtime = { runtimeId: 'host-1', reverseControlReply: jest.fn() } as unknown as BrowserRuntime;
const event = { kind: 'action', action: 'device.info', requestId: 'r1', session: { sessionId: 's1', runtimeId: 'host-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockReturnValue(jest.fn());
});

it('hands Reverse Control requests to the browser registry and registers live runtimes', async () => {
  mockRegistry.event.mockResolvedValue(undefined);
  await act(async () => { create(<Probe runtimes={[runtime]} />); });
  const listener = mockSubscribe.mock.calls[0][0];
  listener(event, runtime);
  expect(mockRegistry.event).toHaveBeenCalledWith(event, runtime);
  expect(mockRegistry.registerRuntimes).toHaveBeenCalledWith([runtime]);
  expect(mockRegistry.reconcile).toHaveBeenCalledWith(runtime);
});

it('answers a request the registry cannot handle instead of letting it time out', async () => {
  mockRegistry.event.mockRejectedValue(new Error('gone'));
  await act(async () => { create(<Probe runtimes={[]} />); });
  await act(async () => { mockSubscribe.mock.calls[0][0](event, runtime); });
  expect(runtime.reverseControlReply).toHaveBeenCalledWith('s1', 'r1', expect.stringContaining('browser_unavailable'));
});

it('stops listening when unmounted', async () => {
  const unsubscribe = jest.fn();
  mockSubscribe.mockReturnValue(unsubscribe);
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Probe runtimes={[]} />); });
  act(() => renderer.unmount());
  expect(unsubscribe).toHaveBeenCalled();
});

it('protects a received background request only until its asynchronous reply completes', async () => {
  const previous = NativeModules.HerdrBackground;
  const previousPlatform = Platform.OS;
  Platform.OS = 'android';
  NativeModules.HerdrBackground = { beginBackgroundWork: jest.fn(() => 7), endBackgroundWork: jest.fn() };
  let finish!: () => void;
  mockRegistry.event.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(<Probe runtimes={[runtime]} />); });
    mockSubscribe.mock.calls[0][0](event, runtime);
    expect(NativeModules.HerdrBackground.beginBackgroundWork).toHaveBeenCalledWith(120_000);
    expect(NativeModules.HerdrBackground.endBackgroundWork).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(NativeModules.HerdrBackground.endBackgroundWork).toHaveBeenCalledWith(7);
  } finally {
    act(() => renderer.unmount());
    NativeModules.HerdrBackground = previous;
    Platform.OS = previousPlatform;
  }
});
