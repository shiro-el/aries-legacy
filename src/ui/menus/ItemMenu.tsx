import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

export type ItemAction = {
  id: 'rename' | 'close' | 'disconnect';
  label: string;
  run: (name?: string) => unknown;
};
type Props = Omit<
  PressableProps,
  'onLongPress' | 'onPressIn' | 'onAccessibilityAction' | 'accessibilityActions'
> & {
  label: string;
  actions: ItemAction[];
  actionsDisabled?: boolean;
  palette?: Palette;
};

/** One sheet owns both actions and the rename editor, including on iOS. */
export function ItemMenu({
  label,
  actions,
  actionsDisabled,
  palette: override,
  children,
  onPress,
  disabled,
  ...props
}: Props) {
  const theme = usePalette();
  const p = override ?? theme;
  const s = useMemo(() => makeStyles(p), [p]);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useRef(false);
  const showing = useRef(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const allowed = !disabled && !actionsDisabled && actions.length > 0;
  const current = useRef({ actions, allowed });
  current.current = { actions, allowed };
  const dismiss = () => {
    showing.current = false;
    setOpen(false);
    setEditing(false);
    setError(null);
  };
  const show = () => {
    if (!current.current.allowed || running.current) return;
    showing.current = true;
    setName(label);
    setEditing(false);
    setError(null);
    setOpen(true);
  };
  const run = async (id: string, fromSheet = false, save = false) => {
    if (
      !mounted.current ||
      !current.current.allowed ||
      running.current ||
      (fromSheet && !showing.current)
    )
      return;
    if (save && !name.trim()) return;
    const action = current.current.actions.find(item => item.id === id);
    if (!action) return;
    if (id === 'rename' && !save) {
      show();
      setEditing(true);
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await action.run(save ? name.trim() : undefined);
      if (mounted.current) dismiss();
    } catch (failure) {
      if (mounted.current) {
        showing.current = true;
        setOpen(true);
        setError(String(failure));
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!allowed) {
      showing.current = false;
      setOpen(false);
      setEditing(false);
    }
  }, [allowed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      showing.current = false;
    };
  }, []);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        {...props}
        disabled={disabled}
        onPressIn={() => {
          held.current = false;
        }}
        onPress={event => {
          if (!held.current) onPress?.(event);
        }}
        onLongPress={
          allowed
            ? () => {
                held.current = true;
                show();
              }
            : undefined
        }
        accessibilityHint={allowed ? t('rail.actionsHint') : undefined}
        accessibilityActions={
          allowed
            ? [
                { name: 'rail-menu', label: t('rail.actions') },
                ...actions.map(action => ({
                  name: action.id,
                  label: action.label,
                })),
              ]
            : undefined
        }
        onAccessibilityAction={event => {
          const id = event.nativeEvent.actionName;
          if (id === 'rail-menu') show();
          else void run(id);
        }}
      >
        {children}
      </Pressable>
      <Modal
        transparent
        animationType="fade"
        visible={open && allowed}
        onRequestClose={dismiss}
      >
        <View style={s.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityLabel={t('common.cancel')}
          />
          <View style={s.sheet} accessibilityViewIsModal>
            <Text style={s.title} accessibilityRole="header">
              {label}
            </Text>
            {editing ? (
              <>
                <TextInput
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  editable={!busy}
                  accessibilityLabel={t('rail.rename')}
                  style={s.input}
                />
                <Pressable
                  disabled={busy || !name.trim()}
                  style={s.action}
                  onPress={() => {
                    void run('rename', true, true);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={s.text}>{t('common.save')}</Text>
                </Pressable>
              </>
            ) : (
              actions.map(action => (
                <Pressable
                  key={action.id}
                  disabled={busy}
                  style={s.action}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => {
                    void run(action.id, true);
                  }}
                >
                  <Text
                    style={[
                      s.text,
                      action.id !== 'rename' && { color: p.removed },
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))
            )}
            {error && (
              <Text style={s.text} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <Pressable
              style={s.action}
              onPress={dismiss}
              accessibilityRole="button"
            >
              <Text style={s.text}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: '#0008',
      padding: space.xl,
      paddingBottom: space.xxl,
    },
    sheet: {
      backgroundColor: p.bg,
      borderRadius: radius.md,
      borderColor: p.seam,
      borderWidth: 1,
      padding: space.lg,
      gap: space.sm,
    },
    title: { ...type.bodyBold, color: p.text, padding: space.sm },
    text: { ...type.body, color: p.text },
    action: { padding: space.md, minHeight: 48 },
    input: {
      ...type.body,
      color: p.text,
      borderWidth: 1,
      borderColor: p.seam,
      borderRadius: radius.sm,
      padding: space.md,
    },
  });
}
