import { NativeModules, Platform } from 'react-native';
import { withBackgroundExecution } from '../src/services/backgroundExecution';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: { HerdrBackground: { beginBackgroundWork: jest.fn(), endBackgroundWork: jest.fn() } },
}));
jest.mock('../src/services/operationalDiagnostics', () => ({
  recordOperationalDiagnostic: jest.fn(), operationalErrorDetails: () => ({}),
}));

const native = NativeModules.HerdrBackground;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  let nextId = 0;
  native.beginBackgroundWork.mockImplementation(() => ++nextId);
});

test('protects asynchronous work immediately, then releases instead of holding an idle lock', async () => {
  let finish!: (value: string) => void;
  const result = withBackgroundExecution(() => {
    expect(native.beginBackgroundWork).toHaveBeenCalledWith(120_000);
    return new Promise<string>(resolve => { finish = resolve; });
  });
  expect(native.endBackgroundWork).not.toHaveBeenCalled();
  finish('reply');
  await expect(result).resolves.toBe('reply');
  expect(native.endBackgroundWork).toHaveBeenCalledWith(1);
  expect(native.beginBackgroundWork).toHaveBeenCalledTimes(1);
});

test('overlapping requests release only their own lock, including on failure', async () => {
  let finish!: () => void;
  const first = withBackgroundExecution(() => new Promise<void>(resolve => { finish = resolve; }));
  await expect(withBackgroundExecution(async () => { throw new Error('failed'); }, 10_000)).rejects.toThrow('failed');
  expect(native.endBackgroundWork.mock.calls).toEqual([[2]]);
  finish();
  await first;
  expect(native.endBackgroundWork.mock.calls).toEqual([[2], [1]]);
});

test('releases after a synchronous exception and does not mask work if locking fails', async () => {
  await expect(withBackgroundExecution(() => { throw new Error('sync'); })).rejects.toThrow('sync');
  expect(native.endBackgroundWork).toHaveBeenCalledWith(1);
  native.beginBackgroundWork.mockImplementationOnce(() => { throw new Error('unavailable'); });
  await expect(withBackgroundExecution(async () => 'still answered')).resolves.toBe('still answered');
  expect(native.endBackgroundWork).toHaveBeenCalledTimes(1);
});

test('iOS runs the operation without calling the Android wake lock API', async () => {
  Platform.OS = 'ios';
  await expect(withBackgroundExecution(async () => 'reply')).resolves.toBe('reply');
  expect(native.beginBackgroundWork).not.toHaveBeenCalled();
  expect(native.endBackgroundWork).not.toHaveBeenCalled();
});
