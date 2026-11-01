import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useLiveHostMonitoring } from '../src/hooks/useLiveHostMonitoring';
import {
  startBackgroundMonitoring,
  stopBackgroundMonitoring,
} from '../src/services/backgroundMonitoring';

jest.mock('../src/services/backgroundMonitoring', () => ({
  startBackgroundMonitoring: jest.fn(async () => {}),
  stopBackgroundMonitoring: jest.fn(async () => {}),
}));
jest.mock('../src/services/latencyDiagnostics', () => ({
  flushLatencyDiagnosticWrites: jest.fn(async () => {}),
}));
jest.mock('../src/services/networkDiagnostics', () => ({
  recordNetworkDiagnostic: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('live hosts keep execution protection through background, lock and UI detach without an alerts preference', async () => {
  const disconnect = jest.fn();
  const setRuntimeMonitoringState = jest.fn();
  const client = { disconnect, setMonitoringState: setRuntimeMonitoringState };
  let change!: (state: string) => void;
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      change = handler as typeof change;
      return { remove };
    });
  function Harness({ locked = false }: { locked?: boolean }) {
    useLiveHostMonitoring({
      liveHostCount: 1,
      restoreComplete: true,
      hostsVisible: true,
      appAccessLocked: locked,
      setRuntimeMonitoringState: client.setMonitoringState,
      onBackgroundMonitoringError: error => {
        throw error;
      },
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(startBackgroundMonitoring).toHaveBeenCalledWith(1);
  await act(async () => {
    change('background');
  });
  expect(setRuntimeMonitoringState).toHaveBeenLastCalledWith(
    false,
    true,
    false,
  );
  await act(async () => {
    renderer.update(<Harness locked />);
  });
  expect(stopBackgroundMonitoring).not.toHaveBeenCalled();
  await act(async () => {
    change('active');
  });
  expect(setRuntimeMonitoringState).toHaveBeenLastCalledWith(true, true, true);
  await act(async () => {
    renderer.unmount();
  });
  expect(disconnect).not.toHaveBeenCalled();
  expect(stopBackgroundMonitoring).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
});

test('starts after restore, updates host count and stops when the last host closes', async () => {
  function Harness({ count, restored }: { count: number; restored: boolean }) {
    useLiveHostMonitoring({
      liveHostCount: count,
      restoreComplete: restored,
      hostsVisible: false,
      appAccessLocked: false,
      setRuntimeMonitoringState: jest.fn(),
      onBackgroundMonitoringError: error => {
        throw error;
      },
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness count={1} restored={false} />);
  });
  expect(startBackgroundMonitoring).not.toHaveBeenCalled();
  expect(stopBackgroundMonitoring).not.toHaveBeenCalled();
  await act(async () => {
    renderer.update(<Harness count={1} restored />);
  });
  expect(startBackgroundMonitoring).toHaveBeenLastCalledWith(1);
  await act(async () => {
    renderer.update(<Harness count={2} restored />);
  });
  expect(startBackgroundMonitoring).toHaveBeenLastCalledWith(2);
  await act(async () => {
    renderer.update(<Harness count={0} restored />);
  });
  expect(stopBackgroundMonitoring).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer.unmount();
  });
});
