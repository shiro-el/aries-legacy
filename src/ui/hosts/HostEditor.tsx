import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ensureTailcatIdentity } from '../../services/hostProfiles';
import { TailcatSettings } from './TailcatSettings';
import { normalizePrivateKey } from '../../lib/privateKey';
import { pickPrivateKeyFile } from '../../services/privateKeyFilePicker';
import type { AuthMode, ConnectionProfile } from '../../types';
import { fonts, radius, space, type, usePalette, type Palette } from '../theme/tokens';

type Props = {
  profile: ConnectionProfile | null;
  /** True when the profile is already saved, so it can be deleted. */
  existing: boolean;
  error?: string | null;
  onSave: (profile: ConnectionProfile) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
};

/** Full-screen sheet for adding a host or changing how Aries reaches it. */
export function HostEditor({ profile, existing, error, onSave, onCancel, onDelete }: Props) {
  const { t } = useTranslation();
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [draft, setDraft] = useState<ConnectionProfile | null>(profile);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [identityError, setIdentityError] = useState(false);
  const [identityAttempt, setIdentityAttempt] = useState(0);

  useEffect(() => {
    setIdentityError(false);
    if (!draft?.tailcatEnabled || (draft.tailcatPrivateKey && draft.tailcatPublicKey)) return;
    let active = true;
    ensureTailcatIdentity(draft).then(prepared => {
      if (active) setDraft(current => current?.id === prepared.id ? {
        ...current, tailcatPrivateKey: prepared.tailcatPrivateKey, tailcatPublicKey: prepared.tailcatPublicKey,
      } : current);
    }).catch(() => { if (active) setIdentityError(true); });
    return () => { active = false; };
  }, [draft, identityAttempt]);

  useEffect(() => {
    setDraft(profile);
    setTouched(false);
  }, [profile]);

  if (!draft) return null;

  const set = <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) =>
    setDraft(current => (current ? { ...current, [field]: value } : current));

  const builtinSsh = Boolean(draft.tailcatEnabled && draft.tailcatSshServer);
  const hostAlias = `tailcat-${draft.id}.invalid`;
  const sshHost = draft.host === hostAlias ? '' : draft.host;
  const address = draft.tailcatEnabled ? draft.tailcatAddress ?? '' : sshHost;
  const identityReady = !draft.tailcatEnabled || Boolean(draft.tailcatPrivateKey && draft.tailcatPublicKey);
  const missing = [
    !address.trim() && 'address',
    !draft.username.trim() && 'username',
  ].filter(Boolean) as string[];
  const portValid = builtinSsh || (/^\d{1,5}$/.test(draft.port.trim() || '22') && Number(draft.port.trim() || '22') > 0 && Number(draft.port.trim() || '22') <= 65535);

  const save = async () => {
    setTouched(true);
    if (missing.length > 0 || !portValid || !identityReady) return;
    setSaving(true);
    try {
      const host = draft.tailcatEnabled ? sshHost.trim() || hostAlias : sshHost.trim();
      await onSave({
        ...draft,
        name: draft.name.trim() || (draft.tailcatEnabled && !sshHost.trim() ? 'Tailcat' : host),
        tailcatAddress: draft.tailcatAddress?.trim(),
        ...(draft.tailcatEnabled ? { jumpHostId: undefined } : {}),
        ...(builtinSsh ? { authMode: 'key', forwardAgent: false } : {}),
        host,
        port: builtinSsh ? '22' : draft.port.trim() || '22',
        username: draft.username.trim(),
        secret: draft.authMode === 'key' ? normalizePrivateKey(draft.secret) : draft.secret,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  const importKey = async () => {
    const key = await pickPrivateKeyFile().catch(() => null);
    if (key) set('secret', key);
  };

  const problem = touched && missing.length > 0
    ? `Enter the ${missing.join(' and ')}.`
    : touched && !portValid ? 'Port must be a number, like 22.' : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={s.screen}>
          <View style={s.bar}>
            <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={8}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
            <Text style={s.heading} accessibilityRole="header">{existing ? 'Edit host' : 'Add host'}</Text>
            <Pressable onPress={() => { void save(); }} disabled={saving || !identityReady} accessibilityState={{ disabled: saving || !identityReady }} accessibilityRole="button" hitSlop={8}>
              <Text style={[s.save, (saving || !identityReady) && s.dim]}>{saving ? 'Saving' : 'Save'}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
            {(problem ?? error) ? <Text style={s.error}>{problem ?? error}</Text> : null}

            <Field label={draft.tailcatEnabled ? t('connection.tailcatAddress') : t('connection.hostOrIp')} hint={draft.tailcatEnabled ? t('connection.tailcatSetup') : undefined} s={s}>
              <TextInput
                style={s.input}
                accessibilityLabel={draft.tailcatEnabled ? t('connection.tailcatAddress') : t('connection.hostOrIp')}
                value={address}
                onChangeText={value => set(draft.tailcatEnabled ? 'tailcatAddress' : 'host', value)}
                secureTextEntry={Boolean(draft.tailcatEnabled)}
                placeholder={draft.tailcatEnabled ? 'tc…' : 'studio.tailnet.ts.net'}
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </Field>
            <View style={s.pair}>
              <Field label="Username" s={s} grow>
                <TextInput
                  style={s.input}
                  value={draft.username}
                  onChangeText={value => set('username', value)}
                  placeholder="you"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
              <Field label="Port" s={s}>
                <TextInput
                  style={[s.input, s.port]}
                  value={builtinSsh ? '22' : draft.port}
                  editable={!builtinSsh}
                  onChangeText={value => set('port', value)}
                  placeholder="22"
                  placeholderTextColor={palette.muted}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
            <Field label="Name" hint="Shown in Herd. Leave empty to use the address." s={s}>
              <TextInput
                style={s.input}
                value={draft.name}
                onChangeText={value => set('name', value)}
                placeholder={sshHost || (draft.tailcatEnabled ? 'Tailcat' : 'studio')}
                placeholderTextColor={palette.muted}
              />
            </Field>

            <Text style={s.label}>Sign in with</Text>
            <View style={s.segment} accessibilityRole="radiogroup">
              {(['password', 'key'] as AuthMode[]).map(mode => {
                const active = draft.authMode === mode;
                return (
                  <Pressable
                    key={mode}
                    disabled={builtinSsh && mode === 'password'}
                    onPress={() => setDraft(current => current && current.authMode !== mode ? { ...current, authMode: mode, secret: '', passphrase: '' } : current)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, disabled: builtinSsh && mode === 'password' }}
                    style={[s.segmentItem, active && s.segmentActive, builtinSsh && mode === 'password' && s.dim]}
                  >
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>
                      {mode === 'password' ? 'Password' : 'Private key'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {draft.authMode === 'password' ? (
              <Field label="Password" s={s}>
                <TextInput
                  style={s.input}
                  value={draft.secret}
                  onChangeText={value => set('secret', value)}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
            ) : (
              <>
                <Field label="Private key" hint="Paste an OpenSSH private key, or import the file." s={s}>
                  <TextInput
                    style={[s.input, s.key]}
                    value={draft.secret}
                    onChangeText={value => set('secret', value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    placeholderTextColor={palette.muted}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    textAlignVertical="top"
                  />
                </Field>
                <Pressable onPress={() => { void importKey(); }} accessibilityRole="button" style={({ pressed }) => [s.quiet, pressed && s.pressed]}>
                  <Text style={s.quietLabel}>Import key file</Text>
                </Pressable>
                <Field label="Key passphrase" hint="Only if the key is encrypted." s={s}>
                  <TextInput
                    style={s.input}
                    value={draft.passphrase}
                    onChangeText={value => set('passphrase', value)}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
              </>
            )}

            <TailcatSettings
              profile={draft}
              identityError={identityError}
              onRetryIdentity={() => setIdentityAttempt(value => value + 1)}
              onEnabledChange={enabled => setDraft(current => current ? {
                ...current, tailcatEnabled: enabled,
                ...(enabled ? { jumpHostId: undefined } : {}),
                ...(enabled && current.tailcatSshServer && current.authMode !== 'key' ? { authMode: 'key', secret: '', passphrase: '' } : {}),
              } : current)}
              onSshServerChange={enabled => setDraft(current => current ? {
                ...current, tailcatSshServer: enabled,
                ...(enabled && current.authMode !== 'key' ? { authMode: 'key', secret: '', passphrase: '' } : {}),
              } : current)}
            />

            <View style={s.toggle}>
              <View style={s.toggleText}>
                <Text style={s.toggleLabel}>Show Herdr agents</Text>
                <Text style={s.hint}>Turn off to use this host as a plain SSH shell.</Text>
              </View>
              <Switch
                value={draft.herdrEnabled !== false}
                onValueChange={value => set('herdrEnabled', value)}
                trackColor={{ true: palette.text, false: palette.seam }}
                thumbColor={palette.bg}
              />
            </View>
            {draft.herdrEnabled !== false && (
              <Field label="Herdr command" hint="How to run Herdr on this host." s={s}>
                <TextInput
                  style={s.input}
                  value={draft.herdrCommand}
                  onChangeText={value => set('herdrCommand', value)}
                  placeholder="herdr"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
            )}

            {existing && (
              <Pressable onPress={onDelete} accessibilityRole="button" style={({ pressed }) => [s.delete, pressed && s.pressed]}>
                <Text style={s.deleteLabel}>Delete host</Text>
              </Pressable>
            )}
          </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, hint, s, grow, children }: {
  label: string;
  hint?: string;
  s: Styles;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[s.field, grow && s.grow]}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.xl,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    heading: { ...type.bodyBold, color: p.text },
    cancel: { ...type.body, color: p.muted },
    save: { ...type.bodyBold, color: p.text },
    dim: { opacity: 0.5 },
    form: { padding: space.xl, gap: space.lg, paddingBottom: 64 },
    error: { ...type.body, color: p.text, padding: space.md, borderRadius: radius.sm, backgroundColor: p.surface },
    field: { gap: 6 },
    grow: { flex: 1 },
    pair: { flexDirection: 'row', gap: space.md },
    label: { ...type.caption, color: p.muted },
    hint: { ...type.caption, color: p.muted },
    input: {
      ...type.body,
      color: p.text,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    port: { width: 84 },
    key: { minHeight: 120, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
    segment: { flexDirection: 'row', padding: 3, borderRadius: radius.sm, backgroundColor: p.surface, marginTop: -space.sm },
    segmentItem: { flex: 1, paddingVertical: space.sm, borderRadius: 8, alignItems: 'center' },
    segmentActive: { backgroundColor: p.bg },
    segmentLabel: { ...type.bodyMedium, color: p.muted },
    segmentLabelActive: { color: p.text },
    quiet: { alignSelf: 'flex-start', paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam, marginTop: -space.sm },
    quietLabel: { ...type.bodyMedium, color: p.text },
    pressed: { backgroundColor: p.surface },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    toggleText: { flex: 1, gap: 2 },
    toggleLabel: { ...type.bodyMedium, color: p.text },
    delete: { alignSelf: 'flex-start', paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.sm, marginTop: space.lg },
    deleteLabel: { ...type.bodyBold, color: p.muted, textDecorationLine: 'underline' },
  });
}
