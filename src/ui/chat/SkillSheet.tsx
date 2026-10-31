import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AgentCatalogEntry } from 'react-native-whip-ssh';

import { radius, space, type, type Palette } from '../theme/tokens';
import { filterSkills, skillSource } from './composerCatalog';

export type CatalogStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

type Props = {
  visible: boolean;
  name: string;
  status: CatalogStatus;
  skills: readonly AgentCatalogEntry[];
  /** How the chosen skill will be written, so the list shows it. */
  token: (name: string) => string;
  palette: Palette;
  onPick: (skill: AgentCatalogEntry) => void;
  onClose: () => void;
};

/** Skills get their own entry, apart from the `/` command list. */
export function SkillSheet({ visible, name, status, skills, token, palette, onPick, onClose }: Props) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);
  const shown = useMemo(() => filterSkills(skills, query), [skills, query]);
  const empty = statusText(status, name, skills.length > 0, query.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close skills" />
      <View style={s.sheet}>
        <View style={s.head}>
          <Text style={s.title} accessibilityRole="header">Skills</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={s.close}>Close</Text>
          </Pressable>
        </View>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search skills"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {status === 'failed' && skills.length > 0 && (
          <Text style={s.note}>Could not refresh the list. These are the skills found last time.</Text>
        )}
        <FlatList
          data={shown}
          keyExtractor={skill => skill.name}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.list}
          ListEmptyComponent={<Text style={s.note}>{empty}</Text>}
          renderItem={({ item }) => {
            const source = skillSource(item.source);
            return (
              <Pressable
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityHint={`Inserts ${token(item.name)} into the message`}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
              >
                <View style={s.rowHead}>
                  <Text style={s.rowName} numberOfLines={1}>{token(item.name)}</Text>
                  {source && <Text style={s.source}>{source}</Text>}
                </View>
                {item.description ? <Text style={s.rowText} numberOfLines={2}>{item.description}</Text> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

function statusText(status: CatalogStatus, name: string, any: boolean, searching: boolean): string {
  if (any) return searching ? 'No skills match that search.' : 'No skills.';
  switch (status) {
    case 'loading': return `Looking up ${name}'s skills on the host.`;
    case 'failed': return `Could not read ${name}'s skills. You can still type a message.`;
    case 'unavailable': return `${name} did not report any skills for this folder.`;
    case 'ready': return `${name} has no skills in this folder.`;
  }
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: {
      maxHeight: '75%',
      backgroundColor: p.bg,
      borderTopLeftRadius: radius.md,
      borderTopRightRadius: radius.md,
      paddingTop: space.lg,
      paddingHorizontal: space.xl,
      gap: space.md,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    title: { ...type.title, color: p.text },
    close: { ...type.body, color: p.muted },
    search: {
      ...type.body,
      color: p.text,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    list: { paddingBottom: space.xxl },
    note: { ...type.caption, color: p.muted, paddingVertical: space.sm },
    row: { paddingVertical: space.md, paddingHorizontal: space.sm, marginHorizontal: -space.sm, borderRadius: 8, gap: 3 },
    pressed: { backgroundColor: p.surface },
    rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    rowName: { ...type.bodyBold, color: p.text, flexShrink: 1 },
    source: { ...type.caption, color: p.muted },
    rowText: { ...type.caption, color: p.muted },
  });
}
