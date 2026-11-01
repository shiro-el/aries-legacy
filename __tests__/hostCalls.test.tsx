import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';

import { mergeCalls, openCallLog, type HostCall } from '../src/services/callLog';
import {
  bindNotificationRuntime,
  unbindNotificationRuntime,
  type NotificationRuntime,
} from '../src/services/notificationRuntimeRegistry';
import { formatCallTime } from '../src/ui/calls/callView';
import { useHostCalls } from '../src/ui/calls/useHostCalls';

type HostCommand = (operation: string, payload: string) => Promise<string>;
type FakeRuntime = NotificationRuntime & { notificationCommand: jest.Mock<Promise<string>, [string, string]> };

// Rust resolves a runtime by ID and runs the host's notification commands.
const mockHosts = new Map<string, HostCommand>();
let mockRuntimeIds = 0;
jest.mock('react-native-whip-ssh', () => {
  const host = (runtimeId: string) => {
    const command = mockHosts.get(runtimeId);
    if (!command) throw new Error('The host connection closed');
    return command;
  };
  return {
    hostCallLogOpen: async (runtimeId: string) => {
      const discovery = JSON.parse(await host(runtimeId)('discover', '{}')) as { paths: unknown };
      return host(runtimeId)('calls-open', JSON.stringify({ paths: discovery.paths }));
    },
    hostCallLogRead: (runtimeId: string) => host(runtimeId)('calls-read', '{}'),
    hostCallLogStop: async (runtimeId: string) => { await host(runtimeId)('calls-stop', '{}'); },
  };
});

function runtimeWith(command: HostCommand): FakeRuntime {
  const runtimeId = `runtime-${++mockRuntimeIds}`;
  const notificationCommand = jest.fn(command);
  mockHosts.set(runtimeId, notificationCommand);
  return { runtimeId, runtimeIncarnation: 1, notificationCommand };
}

jest.mock('../src/services/appStorage', () => ({
  appStorage: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const wire = (id: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  call_id: id,
  pane_id: 'w1:p1',
  created_at: createdAt,
  kind: 'call',
  urgency: 'urgent',
  title: `call ${id}`,
  body: null,
  ...extra,
});

/** A host runtime whose log holds `history` and then yields `pending` reads. */
function fakeRuntime(history: unknown[]) {
  const pending: unknown[][] = [];
  let failRead = false;
  const commands: string[] = [];
  const runtime = runtimeWith(async (operation: string, payload: string) => {
    commands.push(operation);
    switch (operation) {
      case 'discover':
        return JSON.stringify({ paths: { state: '/state', config: '/config', binary: '/bin' } });
      case 'calls-open':
        expect(JSON.parse(payload)).toEqual({ paths: { state: '/state', config: '/config', binary: '/bin' } });
        return JSON.stringify(history);
      case 'calls-read':
        if (failRead) {
          failRead = false;
          throw new Error('Call log stream disconnected; reconnecting');
        }
        return JSON.stringify(pending.shift() ?? []);
      case 'calls-stop':
        return '[]';
      default:
        throw new Error(`unexpected ${operation}`);
    }
  });
  return {
    runtime,
    commands,
    push: (rows: unknown[]) => pending.push(rows),
    drop: () => { failRead = true; },
  };
}

describe('call log service', () => {
  it('reads the snapshot in milliseconds and drops rows it cannot show', async () => {
    const { runtime } = fakeRuntime([wire('a', 100), { call_id: 'b', urgency: 'loud' }, wire('', 5)]);
    const calls = await openCallLog(runtime);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ callId: 'a', createdAt: 100_000, urgency: 'urgent', title: 'call a' });
    expect(calls[0].body).toBeUndefined();
  });

  it('lets a later revision replace a call and keeps newest first', () => {
    const base = (id: string, createdAt: number, reply?: string): HostCall => ({
      callId: id, paneId: 'p', createdAt, kind: 'call', urgency: 'check', reply,
    });
    const merged = mergeCalls([base('a', 1), base('b', 2)], [base('a', 1, 'yes'), base('c', 3)]);
    expect(merged.map(call => call.callId)).toEqual(['c', 'b', 'a']);
    expect(merged[2].reply).toBe('yes');
  });

  it('formats today as a clock and older calls with their date', () => {
    const now = new Date(2026, 10, 1, 15, 0).getTime();
    expect(formatCallTime(new Date(2026, 10, 1, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatCallTime(new Date(2026, 9, 30, 14, 2).getTime(), now)).toBe('Oct 30 14:02');
  });
});

describe('useHostCalls', () => {
  let state: ReturnType<typeof useHostCalls>;
  let root: renderer.ReactTestRenderer;
  function Harness() {
    state = useHostCalls();
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    AppState.currentState = 'active';
  });
  afterEach(() => {
    act(() => root?.unmount());
    jest.useRealTimers();
  });

  const flush = async (ms = 0) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  it('keeps history silent, announces new calls, and ignores reply revisions', async () => {
    const host = fakeRuntime([wire('old', 10)]);
    bindNotificationRuntime('h1', host.runtime);
    await act(async () => { root = renderer.create(<Harness />); });
    await flush();
    expect(state.logs.h1).toMatchObject({ status: 'ready' });
    expect(state.logs.h1.calls.map(call => call.callId)).toEqual(['old']);
    expect(state.arrived).toBeNull();

    host.push([wire('new', 20)]);
    await flush(1000);
    expect(state.logs.h1.calls.map(call => call.callId)).toEqual(['new', 'old']);
    expect(state.arrived).toMatchObject({ hostId: 'h1', call: { callId: 'new' } });

    act(() => state.dismissArrived());
    host.push([wire('new', 20, { reply: 'Yes', reply_status: 'delivered' })]);
    host.push([wire('quiet', 30, { urgency: 'record' })]);
    await flush(2000);
    expect(state.logs.h1.calls[1]).toMatchObject({ callId: 'new', reply: 'Yes', replyStatus: 'delivered' });
    expect(state.logs.h1.calls[0].callId).toBe('quiet');
    expect(state.arrived).toBeNull();
    act(() => unbindNotificationRuntime('h1', host.runtime));
  });

  it('reopens a dropped stream without announcing what it replays', async () => {
    const host = fakeRuntime([wire('old', 10)]);
    bindNotificationRuntime('h2', host.runtime);
    await act(async () => { root = renderer.create(<Harness />); });
    await flush();
    host.drop();
    await flush(1000);
    await flush(1000);
    expect(host.commands.filter(command => command === 'calls-open')).toHaveLength(2);
    expect(state.logs.h2.status).toBe('ready');
    expect(state.arrived).toBeNull();
    act(() => unbindNotificationRuntime('h2', host.runtime));
  });

  it('marks a host unavailable when it has no plugin, and stops following on detach', async () => {
    const runtime = runtimeWith(async (operation: string) => {
      if (operation === 'calls-stop') return '[]';
      throw new Error('Notification plugin unavailable');
    });
    bindNotificationRuntime('h3', runtime);
    await act(async () => { root = renderer.create(<Harness />); });
    await flush();
    expect(state.logs.h3.status).toBe('unavailable');
    act(() => unbindNotificationRuntime('h3', runtime));
    await flush();
    expect(state.logs.h3.status).toBe('offline');
    expect(runtime.notificationCommand).toHaveBeenCalledWith('calls-stop', '{}');
  });

  it('counts calls newer than the last visit to Calls', async () => {
    const host = fakeRuntime([wire('a', Math.floor(Date.now() / 1000) - 60)]);
    bindNotificationRuntime('h4', host.runtime);
    await act(async () => { root = renderer.create(<Harness />); });
    await flush();
    expect(state.unseen).toBe(1);
    act(() => state.markSeen());
    expect(state.unseen).toBe(0);
    act(() => unbindNotificationRuntime('h4', host.runtime));
  });
});
