import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useSessionRuntimeTelemetry } from '../src/hooks/useSessionRuntimeTelemetry';
import type { LiveRuntime } from '../src/hooks/sessionRuntimeTypes';

jest.mock('../src/services/latencyDiagnostics', () => ({
  SLOW_HOST_LATENCY_MS: 2000, isSlowHostLatency: () => false,
}));
jest.mock('../src/services/performanceTrace', () => ({
  beginAppPerformanceTrace: jest.fn(), endAppPerformanceTrace: jest.fn(),
}));

test('ignores queued background RTT samples for React and resumes foreground updates', () => {
  const runtime = { latencyDiagnosticFailureRecorded: true } as LiveRuntime;
  const runtimesRef = { current: new Map([['host', runtime]]) };
  const recordLatency = jest.fn(() => true);
  const telemetry = { state: new Map(), get: jest.fn(), recordLatency, clearLatency: jest.fn() };
  let controller!: ReturnType<typeof useSessionRuntimeTelemetry>;
  function Harness() {
    controller = useSessionRuntimeTelemetry({ runtimesRef, telemetry });
    return null;
  }
  let root!: ReactTestRenderer;
  act(() => { root = create(<Harness />); });
  const sample = { sshRttMs: 30, totalMs: 40, runtimeOverheadMs: 10 };
  AppState.currentState = 'background';
  act(() => controller.handleLatencyMeasurement('host', runtime, sample));
  expect(recordLatency).not.toHaveBeenCalled();
  expect(runtime.latencyDiagnosticFailureRecorded).toBe(false);
  AppState.currentState = 'active';
  act(() => controller.handleLatencyMeasurement('host', runtime, sample));
  expect(recordLatency).toHaveBeenCalledWith('host', 30);
  act(() => root.unmount());
});
