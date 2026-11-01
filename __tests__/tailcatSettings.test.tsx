import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Switch, Text, TextInput } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { getKeyDetails, tailcatServerCommand } from 'react-native-whip-ssh';

import { HostEditor } from '../src/ui/hosts/HostEditor';
import { ensureTailcatIdentity } from '../src/services/hostProfiles';
import type { ConnectionProfile } from '../src/types';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('../src/services/hostProfiles', () => ({ ensureTailcatIdentity: jest.fn() }));
jest.mock('../src/services/privateKeyFilePicker', () => ({ pickPrivateKeyFile: jest.fn() }));
jest.mock('react-native-whip-ssh', () => ({
  getKeyDetails: jest.fn(() => ({ publicKey: 'ssh-ed25519 ssh-public' })),
  tailcatServerCommand: jest.fn((node: string | undefined, port: number, builtin: boolean, ssh: string | undefined) => `serve ${port} ${builtin} ${ssh ?? ''} ${node ?? ''}`),
}));

const profile = (changes: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  id: 'host-1', host: '', name: '', port: '22', username: 'me', authMode: 'password', secret: 'password',
  passphrase: '', herdrCommand: 'herdr', sessionName: '', createdAt: '', updatedAt: '', ...changes,
});
let tree: renderer.ReactTestRenderer;
const onSave = jest.fn().mockResolvedValue(undefined);
const props = { existing: false, onSave, onCancel: jest.fn(), onDelete: jest.fn() };
const toggle = (label: string) => tree.root.findAllByType(Switch).find(node => node.props.accessibilityLabel === label)!;
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function').find(node => node.props.accessibilityLabel === label || node.findAllByType(Text).some(child => [child.props.children].flat().join('') === label))!;
const text = () => JSON.stringify(tree.toJSON());
async function render(value: ConnectionProfile) {
  await act(async () => { tree = renderer.create(<HostEditor {...props} profile={value} />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ensureTailcatIdentity).mockImplementation(async value => ({ ...value, tailcatPrivateKey: 'private-node', tailcatPublicKey: 'public-node' }));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('saves a Tailcat-only host with a private address and stable SSH trust alias', async () => {
  await render(profile());
  await act(async () => toggle('connection.tailcat').props.onValueChange(true));
  const address = tree.root.findByProps({ accessibilityLabel: 'connection.tailcatAddress' });
  expect(address.props.secureTextEntry).toBe(true);
  await act(async () => address.props.onChangeText(' tc-secret '));
  await act(async () => button('Save').props.onPress());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    host: 'tailcat-host-1.invalid', name: 'Tailcat', tailcatAddress: 'tc-secret',
    tailcatPrivateKey: 'private-node', tailcatPublicKey: 'public-node', tailcatEnabled: true,
  }));
  expect(text()).not.toContain('private-node');
});

it('uses key authentication and tunnel port 22 for built-in SSH, and preserves ordinary SSH fields', async () => {
  await render(profile({ host: 'studio', port: '2222', jumpHostId: 'jump' }));
  await act(async () => toggle('connection.tailcat').props.onValueChange(true));
  await act(async () => toggle('connection.tailcatSshServer').props.onValueChange(true));
  const password = tree.root.findAll(node => node.props.accessibilityRole === 'radio' && node.props.disabled)[0];
  expect(password).toBeDefined();
  expect(tree.root.findAllByType(TextInput).find(node => node.props.keyboardType === 'number-pad')?.props).toMatchObject({ value: '22', editable: false });
  await act(async () => tree.root.findByProps({ accessibilityLabel: 'connection.tailcatAddress' }).props.onChangeText('tc-secret'));
  await act(async () => button('Save').props.onPress());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ host: 'studio', port: '22', authMode: 'key', secret: '', forwardAgent: false, jumpHostId: undefined }));
  await act(async () => toggle('connection.tailcat').props.onValueChange(false));
  expect(tree.root.findByProps({ accessibilityLabel: 'connection.hostOrIp' }).props.value).toBe('studio');
  expect(tree.root.findAllByType(TextInput).find(node => node.props.keyboardType === 'number-pad')?.props.value).toBe('2222');
});

it('blocks saving during identity failure and retries through the merged service', async () => {
  jest.mocked(ensureTailcatIdentity).mockRejectedValueOnce(new Error('locked'));
  await render(profile({ tailcatEnabled: true, tailcatAddress: 'tc-address' }));
  expect(text()).toContain('connection.tailcatIdentityError');
  expect(button('Save').props.disabled).toBe(true);
  await act(async () => button('connection.tailcatIdentityRetry').props.onPress());
  expect(text()).toContain('public-node');
  expect(button('Save').props.disabled).toBe(false);
  expect(ensureTailcatIdentity).toHaveBeenCalledTimes(2);
});

it('ignores an identity response after switching to another host', async () => {
  let resolve!: (value: ConnectionProfile) => void;
  jest.mocked(ensureTailcatIdentity).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const old = profile({ tailcatEnabled: true });
  await render(old);
  await act(async () => tree.update(<HostEditor {...props} profile={profile({ id: 'host-2', host: 'other' })} />));
  await act(async () => resolve({ ...old, tailcatPrivateKey: 'stale-private', tailcatPublicKey: 'stale-public' }));
  expect(text()).not.toContain('stale-public');
  expect(tree.root.findByProps({ accessibilityLabel: 'connection.hostOrIp' }).props.value).toBe('other');
});

it('constructs setup and allowlist commands with the native API and copies public content', async () => {
  await render(profile({ tailcatEnabled: true, tailcatSshServer: true, authMode: 'key', secret: 'ssh-private', port: '2222', tailcatPrivateKey: 'node-private', tailcatPublicKey: 'node-public' }));
  await act(async () => button('connection.tailcatHelp').props.onPress());
  expect(getKeyDetails).toHaveBeenCalledWith('ssh-private', undefined);
  expect(tailcatServerCommand).toHaveBeenCalledWith('node-public', 2222, true, 'ssh-ed25519 ssh-public');
  await act(async () => button('markdown.copy: connection.tailcatAllowlistRestart').props.onPress());
  expect(Clipboard.setString).toHaveBeenCalledWith('serve 2222 true ssh-ed25519 ssh-public node-public');
  expect(tree.root.findAllByType(Text).map(node => node.children.filter(child => typeof child === 'string').join('')).join(' ')).not.toContain('ssh-private');
  expect(text()).not.toContain('node-private');
});

it('does not construct a built-in SSH command from a missing or invalid key', async () => {
  jest.mocked(getKeyDetails).mockImplementationOnce(() => { throw new Error('bad key'); });
  await render(profile({ tailcatEnabled: true, tailcatSshServer: true, authMode: 'key', secret: 'bad-key', tailcatPrivateKey: 'private', tailcatPublicKey: 'public' }));
  await act(async () => button('connection.tailcatHelp').props.onPress());
  expect(text()).toContain('connection.tailcatSshKeyRequired');
  expect(tailcatServerCommand).not.toHaveBeenCalled();
});


it('reopens a saved Tailcat-only host without exposing its alias or regenerating identity', async () => {
  await render(profile({ host: 'tailcat-host-1.invalid', tailcatEnabled: true, tailcatAddress: 'tc-saved', tailcatPrivateKey: 'node-private', tailcatPublicKey: 'node-public' }));
  expect(ensureTailcatIdentity).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ accessibilityLabel: 'connection.tailcatAddress' }).props.value).toBe('tc-saved');
  await act(async () => toggle('connection.tailcat').props.onValueChange(false));
  expect(tree.root.findByProps({ accessibilityLabel: 'connection.hostOrIp' }).props.value).toBe('');
  await act(async () => button('Save').props.onPress());
  expect(onSave).not.toHaveBeenCalled();
});

it('requires a Tailcat address even if the original SSH host is filled in', async () => {
  await render(profile({ host: 'studio', tailcatEnabled: true, tailcatPrivateKey: 'private', tailcatPublicKey: 'public' }));
  await act(async () => button('Save').props.onPress());
  expect(onSave).not.toHaveBeenCalled();
});
