import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { DevicePreferencesController } from '../../hooks/useDevicePreferences';
import type { DevicePreferences } from '../../services/devicePreferences';
import { openNotificationSettings } from '../../services/notificationSettings';
import { reportBackgroundFailure } from '../../services/backgroundOperations';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

export type PhoneAlertPreferences = Pick<
  DevicePreferences,
  'alertsEnabled' | 'agentAlertLevel' | 'persistentAlertDurationSeconds'
>;

export type SetPreference = DevicePreferencesController['setPreference'];

type Props = {
  value: PhoneAlertPreferences;
  onChange: SetPreference;
};

/** How this phone alerts for agents on hosts it is connected to. */
export function PhoneAlerts({ value, onChange }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [permission, setPermission] = useState<'granted' | 'ask' | 'denied' | null>(null);

  const check = useCallback(() => {
    reportBackgroundFailure(Notifications.getPermissionsAsync().then(result => {
      setPermission(result.granted ? 'granted' : result.canAskAgain ? 'ask' : 'denied');
    }), 'phone-alerts-permission');
  }, []);

  useEffect(() => {
    check();
    // Coming back from Android settings is the usual way this changes.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check]);

  const sounding = value.agentAlertLevel === 'persistent';

  return (
    <View style={s.section}>
      <Text style={s.title} accessibilityRole="header">This phone</Text>
      {permission === 'ask' || permission === 'denied' ? (
        <View style={s.warning}>
          <Text style={s.body}>Android has notifications turned off for Aries, so no call or alert can reach you.</Text>
          <Pressable
            onPress={() => {
              if (permission === 'ask') {
                reportBackgroundFailure(Notifications.requestPermissionsAsync().then(check), 'phone-alerts-request');
              } else {
                reportBackgroundFailure(openNotificationSettings(), 'phone-alerts-settings');
              }
            }}
            accessibilityRole="button"
            style={({ pressed }) => [s.solid, pressed && s.solidPressed]}
          >
            <Text style={s.solidLabel}>{permission === 'ask' ? 'Allow notifications' : 'Open Android settings'}</Text>
          </Pressable>
        </View>
      ) : null}

      <Toggle
        label="Agent alerts"
        hint="Alert when an agent on a connected host finishes or waits for you."
        value={value.alertsEnabled}
        onChange={next => onChange('alertsEnabled', next)}
        s={s}
        palette={palette}
      />
      {value.alertsEnabled && (
        <Toggle
          label="Sound when an agent waits"
          hint="Sound and vibrate once when an agent needs you. Only emergency calls keep ringing."
          value={sounding}
          onChange={next => onChange('agentAlertLevel', next ? 'persistent' : 'regular')}
          s={s}
          palette={palette}
        />
      )}
      <Pressable
        onPress={() => reportBackgroundFailure(openNotificationSettings(), 'phone-alerts-settings')}
        accessibilityRole="button"
        style={({ pressed }) => [s.link, pressed && s.pressed]}
      >
        <Text style={s.linkLabel}>Sounds and channels in Android settings</Text>
      </Pressable>
    </View>
  );
}

function Toggle({ label, hint, value, onChange, s, palette }: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  s: Styles;
  palette: Palette;
}) {
  return (
    <View style={s.toggle}>
      <View style={s.toggleText}>
        <Text style={s.body}>{label}</Text>
        <Text style={s.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: palette.text, false: palette.seam }}
        thumbColor={palette.bg}
      />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    section: { gap: space.md, paddingTop: space.xxl },
    title: { ...type.title, color: p.text },
    body: { ...type.body, color: p.text },
    hint: { ...type.caption, color: p.muted },
    warning: { gap: space.sm, padding: space.md, borderRadius: radius.sm, backgroundColor: p.surface },
    solid: { alignSelf: 'flex-start', paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    toggleText: { flex: 1, gap: 2 },
    pressed: { backgroundColor: p.surface },
    link: { alignSelf: 'flex-start', paddingVertical: space.xs, borderRadius: 8 },
    linkLabel: { ...type.bodyMedium, color: p.text, textDecorationLine: 'underline' },
  });
}
