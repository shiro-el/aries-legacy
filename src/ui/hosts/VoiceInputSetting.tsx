import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  clearGroqApiKey,
  groqKeySuffix,
  loadGroqApiKey,
  saveGroqApiKey,
  subscribeGroqApiKey,
} from '../../services/groqApiKey';
import { reportBackgroundFailure } from '../../services/backgroundOperations';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

type Props = {
  /** Bumped when the composer's microphone finds no key, to open the editor. */
  editRequest?: number;
};

/** The phone-wide Groq key that composer voice input sends recordings with. */
export function VoiceInputSetting({ editRequest = 0 }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [suffix, setSuffix] = useState<string | null>(null);
  const [editing, setEditing] = useState(editRequest > 0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => reportBackgroundFailure(loadGroqApiKey().then(key => {
      setSuffix(key ? groqKeySuffix(key) : null);
    }), 'groq-key-load');
    refresh();
    return subscribeGroqApiKey(refresh);
  }, []);

  useEffect(() => {
    if (editRequest > 0) setEditing(true);
  }, [editRequest]);

  const save = async () => {
    try {
      await saveGroqApiKey(draft);
      setDraft('');
      setError(null);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the key');
    }
  };

  return (
    <View style={s.section}>
      <Text style={s.label}>Voice input</Text>
      <Text style={s.hint}>
        The composer microphone sends recordings to Groq Whisper with this key. It stays in this phone&apos;s keychain.
      </Text>
      {editing ? (
        <View style={s.editor}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="gsk_…"
            placeholderTextColor={palette.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            accessibilityLabel="Groq API key"
            style={s.input}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.row}>
            <Action label="Save" a11y="Save Groq API key" solid onPress={() => { void save(); }} s={s} />
            <Action label="Cancel" a11y="Cancel Groq API key" onPress={() => { setEditing(false); setDraft(''); setError(null); }} s={s} />
          </View>
        </View>
      ) : (
        <View style={s.row}>
          <Text style={[s.body, s.grow]}>{suffix ? `Groq API key ending in ${suffix}` : 'No Groq API key'}</Text>
          <Action
            label={suffix ? 'Change' : 'Add key'}
            a11y={suffix ? 'Change Groq API key' : 'Add Groq API key'}
            onPress={() => setEditing(true)}
            s={s}
          />
          {suffix ? (
            <Action
              label="Remove"
              a11y="Remove Groq API key"
              onPress={() => reportBackgroundFailure(clearGroqApiKey(), 'groq-key-clear')}
              s={s}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function Action({ label, a11y, solid, onPress, s }: {
  label: string;
  a11y: string;
  solid?: boolean;
  onPress: () => void;
  s: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [solid ? s.solid : s.outline, pressed && (solid ? s.solidPressed : s.pressed)]}
    >
      <Text style={solid ? s.solidLabel : s.outlineLabel}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    section: { gap: space.sm, paddingTop: space.lg },
    label: { ...type.bodyBold, color: p.text },
    body: { ...type.body, color: p.text },
    hint: { ...type.caption, color: p.muted },
    error: { ...type.caption, color: p.text },
    grow: { flex: 1 },
    editor: { gap: space.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    input: {
      ...type.body,
      color: p.text,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
    },
    solid: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
    outline: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    outlineLabel: { ...type.bodyMedium, color: p.text },
    pressed: { backgroundColor: p.surface },
  });
}
