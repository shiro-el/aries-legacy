import Clipboard from '@react-native-clipboard/clipboard';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getKeyDetails, tailcatServerCommand } from 'react-native-whip-ssh';

import { normalizePrivateKey } from '../../lib/privateKey';
import type { ConnectionProfile } from '../../types';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

type Props = {
  profile: ConnectionProfile;
  identityError: boolean;
  onRetryIdentity: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onSshServerChange: (enabled: boolean) => void;
};

/** Per-host transport setup; command construction stays in the native Tailcat API. */
export function TailcatSettings({ profile, identityError, onRetryIdentity, onEnabledChange, onSshServerChange }: Props) {
  const { t } = useTranslation();
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [expanded, setExpanded] = useState(false);
  const { tailcatEnabled: enabled, tailcatSshServer: sshServer, tailcatPublicKey: clientPublicKey, port, authMode, secret, passphrase } = profile;
  const commands = useMemo(() => {
    let sshPublicKey: string | undefined;
    if (enabled && sshServer && authMode === 'key') {
      try { sshPublicKey = getKeyDetails(normalizePrivateKey(secret), passphrase || undefined).publicKey; }
      catch { /* The setup text explains that a usable SSH key is required. */ }
    }
    const parsed = Number(port);
    const sshPort = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 22;
    const command = (nodeKey?: string) => {
      if (sshServer && !sshPublicKey) return undefined;
      try { return tailcatServerCommand(nodeKey, sshPort, Boolean(sshServer), sshPublicKey); }
      catch { return undefined; }
    };
    return { server: command(), allowlist: clientPublicKey ? command(clientPublicKey) : undefined };
  }, [enabled, sshServer, authMode, secret, passphrase, port, clientPublicKey]);

  return (
    <View style={s.section}>
      <View style={s.toggle}>
        <View style={s.copy}>
          <Text style={s.label}>{t('connection.tailcat')}</Text>
          <Text style={s.hint}>{t('connection.tailcatCopy')}</Text>
        </View>
        <Switch accessibilityLabel={t('connection.tailcat')} value={Boolean(enabled)} onValueChange={onEnabledChange}
          trackColor={{ true: palette.text, false: palette.seam }} thumbColor={palette.bg} />
      </View>
      {enabled ? <>
        <View style={s.toggle}>
          <View style={s.copy}>
            <Text style={s.label}>{t('connection.tailcatSshServer')}</Text>
            <Text style={s.hint}>{t('connection.tailcatSshServerCopy')}</Text>
          </View>
          <Switch accessibilityLabel={t('connection.tailcatSshServer')} value={Boolean(sshServer)} onValueChange={onSshServerChange}
            trackColor={{ true: palette.text, false: palette.seam }} thumbColor={palette.bg} />
        </View>
        {clientPublicKey && profile.tailcatPrivateKey ? <Command title={t('connection.tailcatClientIdentity')} command={clientPublicKey} /> :
          <Text accessibilityLiveRegion="polite" style={s.hint}>{t(identityError ? 'connection.tailcatIdentityError' : 'connection.tailcatIdentityCreating')}</Text>}
        {identityError ? <Pressable accessibilityRole="button" onPress={onRetryIdentity} style={s.action}>
          <Text style={s.label}>{t('connection.tailcatIdentityRetry')}</Text>
        </Pressable> : null}
      </> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t('connection.tailcatHelp')} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={s.action}>
        <Text style={s.label}>{t('connection.tailcatHelp')} {expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded ? <View style={s.help}>
        <Text style={s.hint}>{t('connection.tailcatHowItWorks')}</Text>
        <Text style={s.hint}>{t('connection.tailcatRouting')}</Text>
        <Pressable accessibilityRole="link" onPress={() => {
          Linking.openURL('https://github.com/tailscale/tailcat/blob/main/INSTALL.md').catch(error => {
            Alert.alert(t('about.githubError'), String(error));
          });
        }} style={s.action}><Text style={s.link}>{t('connection.tailcatSource')}</Text></Pressable>
        <Text style={s.hint}>{t(sshServer ? 'connection.tailcatBuiltinInstall' : 'connection.tailcatInstall')}</Text>
        <Command title={t('connection.tailcatCreateIdentity')} command="tailcat genkey --key=whip --fixed-region" />
        {commands.server ? <Command title={t('connection.tailcatStartServer')} command={commands.server} /> :
          <Text style={s.hint}>{t('connection.tailcatSshKeyRequired')}</Text>}
        <Text style={s.hint}>{t(sshServer ? 'connection.tailcatBuiltinConnect' : 'connection.tailcatConnect')}</Text>
        <Text style={s.label}>{t('connection.tailcatAllowlist')}</Text>
        <Text style={s.hint}>{t('connection.tailcatAllowlistCopy')}</Text>
        {commands.allowlist ? <Command title={t('connection.tailcatAllowlistRestart')} command={commands.allowlist} /> :
          <Text style={s.hint}>{t(clientPublicKey && sshServer ? 'connection.tailcatSshKeyRequired' : 'connection.tailcatIdentityInEditor')}</Text>}
      </View> : null}
    </View>
  );
}

function Command({ title, command }: { title: string; command: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  return <View style={s.copy}>
    <View style={s.toggle}>
      <Text style={[s.hint, s.copy]}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('markdown.copy')}: ${title}`} onPress={() => Clipboard.setString(command)} style={s.action}>
        <Text style={s.label}>{t('markdown.copy')}</Text>
      </Pressable>
    </View>
    <Text selectable style={s.command}>{command}</Text>
  </View>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    section: { gap: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.seam, paddingTop: space.lg },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    copy: { flex: 1, gap: space.xs },
    label: { ...type.bodyMedium, color: p.text },
    hint: { ...type.caption, color: p.muted },
    command: { ...type.caption, color: p.text, backgroundColor: p.surface, padding: space.md, borderRadius: radius.sm },
    action: { paddingVertical: space.sm },
    link: { ...type.bodyMedium, color: p.text, textDecorationLine: 'underline' },
    help: { gap: space.md },
  });
}
