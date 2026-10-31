import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { UnknownHostKeyChallenge } from '../services/knownHosts';
import { radius, space, type, usePalette, type Palette } from './theme/tokens';

/** Asks before trusting a host key seen for the first time. */
export function HostKeyPrompt({ challenge, onResolve }: {
  challenge: UnknownHostKeyChallenge | null;
  onResolve: (trusted: boolean) => void;
}) {
  const s = useGateStyles();
  return (
    <Modal visible={challenge !== null} transparent animationType="fade" onRequestClose={() => onResolve(false)}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <Text style={s.heading} accessibilityRole="header">Trust this host?</Text>
          <Text style={s.body}>
            First connection to {challenge?.host}:{challenge?.port}. Check that this fingerprint matches the server before you trust it.
          </Text>
          <Text style={s.code} selectable>{challenge?.keyType}{'\n'}{challenge?.fingerprint}</Text>
          <View style={s.actions}>
            <Pressable style={[s.button, s.quiet]} onPress={() => onResolve(false)} accessibilityRole="button">
              <Text style={s.quietLabel}>Cancel</Text>
            </Pressable>
            <Pressable style={[s.button, s.gold]} onPress={() => onResolve(true)} accessibilityRole="button">
              <Text style={s.goldLabel}>Trust host</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Shown while biometric app lock is engaged. */
export function LockScreen({ authenticating, onUnlock }: { authenticating: boolean; onUnlock: () => void }) {
  const s = useGateStyles();
  return (
    <View style={s.lock}>
      <Text style={s.heading}>Aries is locked</Text>
      <Pressable style={[s.button, s.gold]} onPress={onUnlock} disabled={authenticating} accessibilityRole="button">
        <Text style={s.goldLabel}>{authenticating ? 'Unlocking' : 'Unlock'}</Text>
      </Pressable>
    </View>
  );
}

/** Confirms deleting a saved host, its credentials and its cached herd. */
export function DeleteHostPrompt({ name, busy, onCancel, onConfirm }: {
  name: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const s = useGateStyles();
  return (
    <Modal visible={name !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <Text style={s.heading} accessibilityRole="header">Delete {name}?</Text>
          <Text style={s.body}>
            Aries disconnects and forgets this host, its saved password or key, and its chat history. Agents on the host keep running.
          </Text>
          <View style={s.actions}>
            <Pressable style={[s.button, s.quiet]} onPress={onCancel} accessibilityRole="button">
              <Text style={s.quietLabel}>Keep host</Text>
            </Pressable>
            <Pressable style={[s.button, s.solid]} onPress={onConfirm} disabled={busy} accessibilityRole="button">
              <Text style={s.solidLabel}>{busy ? 'Deleting' : 'Delete host'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function useGateStyles() {
  const palette = usePalette();
  return useMemo(() => makeStyles(palette), [palette]);
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30,27,25,0.6)' },
    sheet: { backgroundColor: p.bg, padding: space.xl, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, gap: space.md },
    heading: { ...type.title, color: p.text },
    body: { ...type.body, color: p.muted },
    code: { ...type.caption, color: p.text, backgroundColor: p.surface, padding: space.md, borderRadius: radius.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, paddingTop: space.sm },
    button: { paddingVertical: 10, paddingHorizontal: space.lg, borderRadius: radius.sm },
    quiet: { borderWidth: 1.5, borderColor: p.seam },
    quietLabel: { ...type.bodyBold, color: p.text },
    gold: { backgroundColor: p.gold },
    solid: { backgroundColor: p.text },
    solidLabel: { ...type.bodyBold, color: p.bg },
    goldLabel: { ...type.bodyBold, color: p.onGold },
    lock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, backgroundColor: p.bg },
  });
}
