import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Pressable, TextInput } from 'react-native';
import { ItemMenu, type ItemAction } from '../src/ui/menus/ItemMenu';
import { HerdScreen } from '../src/ui/herd/HerdScreen';
import { TerminalScreen } from '../src/ui/terminal/TerminalScreen';
import type { SessionPresentation } from '../src/liveHostSessions';

jest.mock('../src/ui/herd/StatusGlyph', () => ({
  StatusGlyph: 'StatusGlyph',
  GLYPH_SIZE: 12,
}));
jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'dark',
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../src/ui/terminal/TerminalSurface', () => ({
  TerminalSurface: 'TerminalSurface',
}));

let tree: ReactTestRenderer;
const rename = jest.fn();
const close = jest.fn();
const select = jest.fn();
const actions: ItemAction[] = [
  { id: 'rename', label: 'Rename tab', run: rename },
  { id: 'close', label: 'Close tab', run: close },
];
const mount = (disabled = false) => {
  void act(() => {
    tree = create(
      <StrictMode>
        <ItemMenu
          label="Shell"
          actions={actions}
          actionsDisabled={disabled}
          onPress={select}
        />
      </StrictMode>,
    );
  });
};
const trigger = () => tree.root.findAllByType(Pressable)[0];
const button = (label: string) =>
  tree.root
    .findAllByType(Pressable)
    .find(item => item.props.accessibilityLabel === label)!;
const sheet = () => tree.root.findByType(Modal);
const hold = () => {
  void act(() => {
    trigger().props.onPressIn();
    trigger().props.onLongPress();
  });
};
const a11y = (name: string) => {
  void act(() => {
    trigger().props.onAccessibilityAction({
      nativeEvent: { actionName: name },
    });
  });
};
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  void act(() => tree?.unmount());
});

test('tap selects, long press opens actions without selecting or closing', () => {
  mount();
  void act(() => trigger().props.onPress());
  expect(select).toHaveBeenCalledTimes(1);
  select.mockClear();
  hold();
  void act(() => trigger().props.onPress());
  expect(sheet().props.visible).toBe(true);
  expect(select).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test('close runs once even if a saved callback is invoked twice', async () => {
  mount();
  hold();
  const run = button('Close tab').props.onPress;
  await act(async () => {
    run();
    run();
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(sheet().props.visible).toBe(false);
  void act(() => run());
  expect(close).toHaveBeenCalledTimes(1);
});

test('rename edits locally and saves a trimmed name', async () => {
  mount();
  hold();
  void act(() => button('Rename tab').props.onPress());
  expect(rename).not.toHaveBeenCalled();
  void act(() =>
    tree.root.findByType(TextInput).props.onChangeText('  Agent  '),
  );
  const save = tree.root
    .findAllByType(Pressable)
    .find(item =>
      item
        .findAllByType('Text' as never)
        .some(text => text.props.children === 'common.save'),
    )!;
  await act(async () => {
    save.props.onPress();
  });
  expect(rename).toHaveBeenCalledWith('Agent');
});

test('Back and cancel dismiss; a new tap selects normally', () => {
  mount();
  hold();
  void act(() => sheet().props.onRequestClose());
  expect(sheet().props.visible).toBe(false);
  hold();
  void act(() => button('common.cancel').props.onPress());
  void act(() => {
    trigger().props.onPressIn();
    trigger().props.onPress();
  });
  expect(select).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

test('disabled actions preserve selection and reject stale callbacks', () => {
  mount();
  hold();
  const stale = button('Close tab').props.onPress;
  void act(() =>
    tree.update(
      <StrictMode>
        <ItemMenu
          label="Shell"
          actions={actions}
          actionsDisabled
          onPress={select}
        />
      </StrictMode>,
    ),
  );
  expect(sheet().props.visible).toBe(false);
  expect(trigger().props.onLongPress).toBeUndefined();
  expect(trigger().props.accessibilityActions).toBeUndefined();
  void act(() => stale());
  expect(close).not.toHaveBeenCalled();
  void act(() => {
    trigger().props.onPressIn();
    trigger().props.onPress();
  });
  expect(select).toHaveBeenCalled();
});

test('screen readers can open the menu, rename, and close', async () => {
  mount();
  a11y('rail-menu');
  expect(sheet().props.visible).toBe(true);
  a11y('rename');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  await act(async () => {
    trigger().props.onAccessibilityAction({
      nativeEvent: { actionName: 'close' },
    });
  });
  expect(close).toHaveBeenCalledTimes(1);
});

test('operation failure stays visible and can be retried', async () => {
  close.mockRejectedValueOnce(new Error('Offline'));
  mount();
  hold();
  await act(async () => {
    button('Close tab').props.onPress();
  });
  expect(sheet().props.visible).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  await act(async () => {
    button('Close tab').props.onPress();
  });
  expect(close).toHaveBeenCalledTimes(2);
});

test('Herd maps host, workspace and tab labels to the correct menus', () => {
  const workspaceActions = jest.fn(() => actions);
  const tabActions = jest.fn(() => actions);
  void act(() => {
    tree = create(
      <HerdScreen
        sections={[
          {
            sessionId: 's',
            hostId: 'h',
            hostName: 'Dev',
            state: 'ready',
            view: {
              needYou: 0,
              working: 0,
              workspaces: [
                {
                  workspaceId: 'w',
                  label: 'Project',
                  tabs: [{ tabId: 't', label: 'Agent', panes: [] }],
                },
              ],
            },
          },
        ]}
        savedHosts={[]}
        onConnect={jest.fn()}
        onDisconnect={close}
        workspaceActions={workspaceActions}
        tabActions={tabActions}
      />,
    );
  });
  expect(workspaceActions).toHaveBeenCalledWith('s', 'w');
  expect(tabActions).toHaveBeenCalledWith('s', 't');
  expect(
    tree.root.findAllByType(ItemMenu).map(item => item.props.label),
  ).toEqual(['Dev', 'Project', 'Agent']);
});

test('even a single terminal exposes actions, without closing on long press', () => {
  const terminalActions = jest.fn(() => actions);
  const session = {
    host: { name: 'Dev' },
    snapshot: { panes: [] },
    terminalRail: { terminals: [{ terminalId: 'ssh-1', title: 'Shell' }] },
  } as unknown as SessionPresentation;
  void act(() => {
    tree = create(
      <TerminalScreen
        session={session}
        target={null}
        fontSize={14}
        onBack={jest.fn()}
        onSelectTerminal={select}
        terminalActions={terminalActions}
        onStatus={jest.fn()}
      />,
    );
  });
  expect(terminalActions).toHaveBeenCalledWith('ssh-1');
  const item = tree.root.findByType(ItemMenu).findAllByType(Pressable)[0];
  void act(() => item.props.onLongPress());
  expect(close).not.toHaveBeenCalled();
  expect(sheet().props.visible).toBe(true);
});
