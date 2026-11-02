import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Platform, Switch, Text } from 'react-native';
import { HerdrAgentKind, ReverseControlState, type AgentControlView } from 'react-native-whip-ssh';

import { SessionAccessMenu } from '../src/ui/shizuku/SessionAccessMenu';
import { ShizukuSection } from '../src/ui/shizuku/ShizukuSection';
import * as service from '../src/services/shizuku';

jest.mock('react-native-whip-ssh', () => require('./mockWhipSsh').createMockWhipSshModule());
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../src/services/shizuku', () => ({
  getShizukuStatus: jest.fn(), pairShizuku: jest.fn(), openShizukuManager: jest.fn(),
  downloadShizuku: jest.fn(), subscribeToShizukuStatus: jest.fn(),
}));

let root: ReactTestRenderer;
let listener: (status: service.ShizukuStatus) => void;
const unsubscribe = jest.fn();
const control: AgentControlView = {
  terminalId: 'terminal-a', kind: HerdrAgentKind.Codex, reverseControl: true,
  shizukuAccess: false, connected: true, reverseControlState: ReverseControlState.Connected,
};
const button = (label: string) => root.root.findAll(node => node.props.accessibilityRole === 'button'
  && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); };
const texts = () => root.root.findAllByType(Text).map(node => node.props.children).flat();

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  jest.mocked(service.getShizukuStatus).mockResolvedValue('permission_required');
  jest.mocked(service.pairShizuku).mockResolvedValue('ready');
  jest.mocked(service.subscribeToShizukuStatus).mockImplementation(callback => { listener = callback; return unsubscribe; });
});
afterEach(() => { if (root) { act(() => root.unmount()); } Platform.OS = 'ios'; });

async function setup() { await act(async () => { root = renderer.create(<ShizukuSection />); }); }

it('pairs only on explicit action and follows permission changes with cleanup', async () => {
  await setup();
  expect(service.pairShizuku).not.toHaveBeenCalled();
  await press('shizuku.pair');
  expect(service.pairShizuku).toHaveBeenCalledTimes(1);
  expect(texts()).toContain('shizuku.status.ready');
  await act(async () => listener('denied'));
  expect(texts()).toContain('shizuku.status.denied');
  await press('shizuku.open');
  expect(service.openShizukuManager).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  expect(unsubscribe).toHaveBeenCalled();
});

it.each(['not_installed', 'stopped', 'unsupported', 'ready', 'unavailable'] as const)('handles setup status %s', async status => {
  jest.mocked(service.getShizukuStatus).mockResolvedValue(status);
  await setup();
  if (status === 'unavailable') {
    expect(button('shizuku.pair').props.disabled).toBe(true);
  } else {
    await press(status === 'not_installed' ? 'shizuku.install' : 'shizuku.open');
    expect(status === 'not_installed' ? service.downloadShizuku : service.openShizukuManager).toHaveBeenCalledTimes(1);
  }
});

it('shows errors and retries using fresh service state', async () => {
  jest.mocked(service.getShizukuStatus).mockRejectedValueOnce(new Error('offline'));
  await setup();
  expect(texts()).toContain('shizuku.error');
  await press('shizuku.pair');
  expect(texts()).toContain('shizuku.status.ready');
});

it('refreshes when returning from the manager', async () => {
  const events = jest.spyOn(AppState, 'addEventListener');
  await setup();
  jest.mocked(service.getShizukuStatus).mockResolvedValue('stopped');
  const callback = events.mock.calls.find(call => call[0] === 'change')![1];
  await act(async () => { callback('active'); });
  expect(texts()).toContain('shizuku.status.stopped');
  events.mockRestore();
});

it('offers only the Reverse Control switch and reports mutation failures', async () => {
  const change = jest.fn().mockRejectedValue(new Error('disconnected'));
  const props = { control: { ...control, reverseControl: false }, connected: true, onChange: change, onRestart: jest.fn() };
  await act(async () => { root = renderer.create(<SessionAccessMenu {...props} />); });
  await press('herd.agentActions');
  expect(root.root.findAllByType(Switch)).toHaveLength(1);
  await act(async () => root.root.findAllByType(Switch)[0].props.onValueChange(true));
  expect(change).toHaveBeenLastCalledWith(true, false);
  expect(texts()).toContain('Error: disconnected');
  await act(async () => root.update(<SessionAccessMenu {...props} connected={false} />));
  expect(root.root.findAllByType(Switch)[0].props.disabled).toBe(true);
});

it('exposes restart when the runtime requires it', async () => {
  const restart = jest.fn().mockResolvedValue(undefined);
  await act(async () => { root = renderer.create(<SessionAccessMenu control={{ ...control, reverseControlState: ReverseControlState.RestartRequired }} connected onChange={jest.fn()} onRestart={restart} />); });
  await press('herd.agentActions');
  const restartButton = root.root.findAll(node => node.props.accessibilityRole === 'button' && node.findAllByType(Text).some(text => text.props.children === 'herd.restartNow'))[0];
  await act(async () => restartButton.props.onPress());
  expect(restart).toHaveBeenCalledTimes(1);
});

it('renders no Shizuku UI on iOS', async () => {
  Platform.OS = 'ios';
  await act(async () => { root = renderer.create(<><ShizukuSection /><SessionAccessMenu control={control} connected onChange={jest.fn()} onRestart={jest.fn()} /></>); });
  expect(root.toJSON()).toBeNull();
  expect(service.getShizukuStatus).not.toHaveBeenCalled();
});
