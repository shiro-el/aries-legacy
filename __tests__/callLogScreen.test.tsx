import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';
import { createHostRuntime } from 'react-native-whip-ssh';
import { CallLogSurface } from '../src/components/CallLogSurface';
import {
  bindNotificationRuntime,
  unbindNotificationRuntime,
} from '../src/services/notificationRuntimeRegistry';

jest.mock('react-native-whip-ssh', () =>
  require('./mockWhipSsh').createMockWhipSshModule(),
);
jest.mock('react-native-css-interop/jsx-runtime', () =>
  jest.requireActual('react/jsx-runtime'),
);
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));
jest.mock('../src/components/ui/text', () => ({ Text: 'Text' }));

const historical = {
  call_id: 'old',
  kind: 'call',
  urgency: 'record',
  requested_urgency: 'urgent',
  ineligible_reason: '자격 없음',
  created_at: 100,
  pane_id: 'p1',
  title: 'Offline news',
  body: 'Finished report',
};
let root: ReactTestRenderer;
let runtime: ReturnType<typeof createHostRuntime>;
let command: jest.Mock;
const openPane = jest.fn();
const hosts = [{ id: 'host', label: 'Workstation' }];
function texts() {
  return root.root
    .findAllByType('Text' as never)
    .flatMap(n => n.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ');
}
async function press(label: string) {
  await act(async () =>
    root.root.findByProps({ accessibilityLabel: label }).props.onPress(),
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  openPane.mockReset();
  command = jest.fn(async (operation: string) =>
    operation === 'discover'
      ? JSON.stringify({ paths: { state: '/state' } })
      : JSON.stringify([historical]),
  );
  runtime = createHostRuntime({ runtimeId: 'host' } as never);
  (runtime as unknown as { controlClient: unknown }).controlClient = {
    notificationCommand: command,
  };
  bindNotificationRuntime('host', runtime);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  unbindNotificationRuntime('host', runtime);
  jest.useRealTimers();
});
test('shows offline host history with urgency, time, pane and ineligibility', async () => {
  await act(async () => {
    root = create(<CallLogSurface hosts={hosts} onOpenPane={openPane} />);
  });
  await press('Call log');
  expect(texts()).toContain('Offline news');
  expect(texts()).toContain('record');
  expect(texts()).toContain('p1');
  expect(texts()).toContain('자격 없음');
  expect(texts()).toContain(new Date(100000).toLocaleString());
  expect(texts()).not.toContain('New call');
});
test('filters calls by effective urgency and opens the recorded host pane', async () => {
  const approval = {
    ...historical,
    call_id: 'approval',
    kind: 'approval',
    urgency: 'check',
    title: 'Approve command',
    created_at: 200,
    reply: 'Approved',
  };
  command.mockImplementation(async (op: string) =>
    op === 'discover' ? '{"paths":{}}' : JSON.stringify([historical, approval]),
  );
  await act(async () => {
    root = create(<CallLogSurface hosts={hosts} onOpenPane={openPane} />);
  });
  await press('Call log');
  expect(texts().indexOf('Approve command')).toBeLessThan(
    texts().indexOf('Offline news'),
  );
  expect(texts()).toContain('Approved');
  await press('check');
  expect(texts()).toContain('Approve command');
  expect(texts()).not.toContain('Offline news');
  await press('Open Approve command');
  expect(openPane).toHaveBeenCalledWith('host', 'p1');
  expect(root.root.findByType('Modal' as never).props.visible).toBe(false);
});
test('shows each new foreground call once, including while the log sheet is closed; record stays silent', async () => {
  const live = {
    ...historical,
    call_id: 'live',
    urgency: 'urgent',
    title: 'Need a decision',
  };
  await act(async () => {
    root = create(<CallLogSurface hosts={hosts} onOpenPane={openPane} />);
  });
  expect(texts()).not.toContain('New call');
  command.mockImplementation(async () => JSON.stringify([historical, live]));
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(texts()).toContain('New call');
  expect(texts()).toContain('Need a decision');
  await press('Dismiss call');
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(texts()).not.toContain('New call');
  await press('Call log');
  expect(texts()).toContain('Need a decision');
});
test('keeps hosts separate and reports missing panes without closing history', async () => {
  openPane.mockRejectedValue(new Error('This pane no longer exists'));
  await act(async () => {
    root = create(
      <CallLogSurface
        hosts={[...hosts, { id: 'other', label: 'Laptop' }]}
        onOpenPane={openPane}
      />,
    );
  });
  await press('Call log');
  await press('Laptop');
  expect(texts()).not.toContain('Offline news');
  expect(texts()).toContain('Connect to this host');
  await press('Workstation');
  await press('Open Offline news');
  expect(texts()).toContain('This pane no longer exists');
  expect(root.root.findByType('Modal' as never).props.visible).toBe(true);
});
test('stops reading in background, resumes without replaying history, and cleans up', async () => {
  let change: (state: string) => void = () => {};
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type, callback) => {
      change = callback;
      return { remove: jest.fn() };
    },
  );
  await act(async () => {
    root = create(<CallLogSurface hosts={hosts} onOpenPane={openPane} />);
  });
  command.mockClear();
  await act(async () => {
    AppState.currentState = 'background';
    change('background');
    jest.advanceTimersByTime(3000);
  });
  expect(command.mock.calls.map(call => call[0])).toEqual(['calls-stop']);
  await act(async () => {
    AppState.currentState = 'active';
    change('active');
  });
  expect(texts()).not.toContain('New call');
});
test('catches up foreground calls after a stream failure without alerting old history', async () => {
  await act(async () => {
    root = create(<CallLogSurface hosts={hosts} onOpenPane={openPane} />);
  });
  command.mockRejectedValueOnce(new Error('connection replaced'));
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  command.mockImplementation(async (op: string) =>
    op === 'discover'
      ? '{"paths":{}}'
      : JSON.stringify([
          historical,
          {
            ...historical,
            call_id: 'caught-up',
            urgency: 'check',
            title: 'Call during reconnect',
          },
        ]),
  );
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(texts()).toContain('New call');
  expect(texts()).toContain('Call during reconnect');
});
test('offers a connection from the selected offline host history', async () => {
  const connect = jest.fn(async () => {});
  await act(async () => {
    root = create(
      <CallLogSurface
        hosts={[{ id: 'offline', label: 'Offline host' }]}
        onOpenPane={openPane}
        onConnectHost={connect}
      />,
    );
  });
  await press('Call log');
  await press('Connect host');
  expect(connect).toHaveBeenCalledWith('offline');
});
