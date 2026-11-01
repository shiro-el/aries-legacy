import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HerdrAgentKind, ReverseControlState, type AgentControlView } from 'react-native-whip-ssh';

import { reverseControlStateLabel } from '../../services/agentPreferences';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { ShizukuAccessToggle } from './ShizukuAccessToggle';

export type SessionAccessActions = {
  control: AgentControlView | undefined;
  connected: boolean;
  onChange: (enabled: boolean, shizukuAccess: boolean) => Promise<void>;
  onRestart: () => Promise<void>;
};

/** Values come from Rust's session projection; this menu never persists a grant. */
export function SessionAccessMenu({ control, connected, onChange, onRestart, palette }: SessionAccessActions & { palette?: Palette }) {
  const { t } = useTranslation();
  const theme = usePalette();
  const p = palette ?? theme;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (Platform.OS !== 'android' || !control || ![HerdrAgentKind.Claude, HerdrAgentKind.Codex, HerdrAgentKind.OpenCode].includes(control.kind)) return null;
  const apply = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (cause) { setError(String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const disabled = busy || !connected;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('herd.agentActions')} onPress={() => setOpen(true)} style={s.trigger}>
        <Text style={[type.bodyBold, { color: p.text }]}>···</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!busy) setOpen(false); }}>
        <View style={s.overlay}>
          <View accessibilityViewIsModal style={[s.card, { backgroundColor: p.bg, borderColor: p.seam }]}>
            <Text accessibilityRole="header" style={[type.title, { color: p.text }]}>{t('herd.agentActions')}</Text>
            <View style={s.row}>
              <View style={s.copy}>
                <Text style={[type.bodyMedium, { color: p.text }]}>{t('herd.reverseControl')}</Text>
                <Text accessibilityLiveRegion="polite" style={[type.caption, { color: p.muted }]}>
                  {busy ? t('herd.applyingAgentAction') : reverseControlStateLabel(control, t)}
                </Text>
              </View>
              <Switch accessibilityLabel={t('herd.reverseControl')} value={control.reverseControl} disabled={disabled}
                trackColor={{ false: p.seam, true: p.muted }} thumbColor={p.text}
                onValueChange={enabled => { void apply(() => onChange(enabled, false)); }} />
            </View>
            <ShizukuAccessToggle checked={control.shizukuAccess} disabled={disabled || !control.reverseControl}
              onCheckedChange={enabled => { void apply(() => onChange(true, enabled)); }} />
            {error ? <Text accessibilityLiveRegion="polite" style={[type.caption, { color: p.removed }]}>{error}</Text> : null}
            {control.reverseControlState === ReverseControlState.RestartRequired ? (
              <>
                <Text style={[type.caption, { color: p.muted }]}>{t('herd.restartBusyCopy')}</Text>
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { void apply(onRestart); }} style={[s.button, { borderColor: p.seam }]}>
                  <Text style={[type.bodyMedium, { color: p.text }]}>{t('herd.restartNow')}</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOpen(false)} style={[s.button, { borderColor: p.seam }]}>
              <Text style={[type.bodyMedium, { color: p.text }]}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: '#00000088' },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', padding: space.xl, borderRadius: radius.md, borderWidth: 1, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  copy: { flex: 1, gap: space.xs },
  button: { alignSelf: 'flex-end', paddingHorizontal: space.md, paddingVertical: space.sm, borderWidth: 1.5, borderRadius: radius.sm },
});
