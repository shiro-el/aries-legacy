import { Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { space, type, usePalette } from '../theme/tokens';

type Props = {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (enabled: boolean) => void;
};

export function ShizukuAccessToggle({ checked, disabled, onCheckedChange }: Props) {
  const { t } = useTranslation();
  const p = usePalette();
  if (Platform.OS !== 'android') return null;
  return (
    <View style={s.row}>
      <View style={s.copy}>
        <Text style={[type.bodyMedium, { color: p.text }]}>{t('shizuku.access')}</Text>
        <Text style={[type.caption, { color: p.muted }]}>{t('shizuku.accessCopy')}</Text>
      </View>
      <Switch
        accessibilityLabel={t('shizuku.access')}
        accessibilityHint={t('shizuku.accessCopy')}
        value={checked}
        disabled={disabled}
        onValueChange={onCheckedChange}
        trackColor={{ false: p.seam, true: p.muted }}
        thumbColor={p.text}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  copy: { flex: 1, gap: space.xs },
});
