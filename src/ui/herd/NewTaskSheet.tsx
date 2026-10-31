import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HostRuntimeConnection, RuntimeRemoteFileEntry } from 'react-native-whip-ssh';

import type { TabLaunchIntent } from '../../lib/herdrCreationFlows';
import { reportBackgroundFailure } from '../../services/backgroundOperations';
import {
  loadNewTaskPreferences,
  rememberNewTask,
  type NewTaskAgent,
  type NewTaskChoice,
} from '../../services/newTaskPreferences';
import { fonts, radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { AGENTS, folderLabel, folderSuggestions, launchFor, parentFolder, type FirstPane } from './newTask';

export type NewTaskHost = {
  sessionId: string;
  hostId: string;
  hostName: string;
  /** Folders the host's open panes work in. */
  paneFolders: string[];
};

type Props = {
  visible: boolean;
  hosts: NewTaskHost[];
  runtime: (sessionId: string) => HostRuntimeConnection | null;
  onCreate: (sessionId: string, label: string, cwd: string, launch: TabLaunchIntent) => Promise<void>;
  onClose: () => void;
};

const BLANK: NewTaskChoice = { model: '', effort: '' };
const PANES: { value: FirstPane; label: string }[] = [
  { value: 'claude', label: AGENTS.claude.name },
  { value: 'codex', label: AGENTS.codex.name },
  { value: 'shell', label: 'Shell' },
];

type Browse = { path: string; entries: RuntimeRemoteFileEntry[] | null; error: string | null };

/**
 * Starts work from the phone: a folder, one workspace, and its first pane.
 * Whatever the agent builds after that is up to the agent.
 */
export function NewTaskSheet({ visible, hosts, runtime, onCreate, onClose }: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [label, setLabel] = useState('');
  const [pane, setPane] = useState<FirstPane>('claude');
  const [choices, setChoices] = useState<Record<NewTaskAgent, NewTaskChoice>>({ claude: BLANK, codex: BLANK });
  const [recent, setRecent] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const host = hosts.find(candidate => candidate.sessionId === sessionId) ?? hosts[0];
  const hostId = host?.hostId;

  // Each opening starts clean on the first host.
  useEffect(() => {
    if (!visible) return;
    setSessionId(hosts[0]?.sessionId ?? null);
    setFolder('');
    setLabel('');
    setBrowse(null);
    setError(null);
    setCreating(false);
    // Hosts change while the sheet is open; only an opening resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !hostId) return;
    let current = true;
    setRecent([]);
    loadNewTaskPreferences(hostId)
      .then(preferences => {
        if (!current) return;
        setRecent(preferences.folders);
        setChoices({ claude: preferences.agents.claude ?? BLANK, codex: preferences.agents.codex ?? BLANK });
      })
      .catch(() => {
        if (current) setChoices({ claude: BLANK, codex: BLANK });
      });
    return () => {
      current = false;
    };
  }, [hostId, visible]);

  const agent = pane === 'shell' ? null : pane;
  const choice = agent ? choices[agent] : BLANK;
  useEffect(() => {
    setCustomModel(agent !== null && choice.model !== '' && !AGENTS[agent].models.includes(choice.model));
    // Recompute only when the agent changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, hostId]);

  const suggestions = useMemo(
    () => folderSuggestions(recent, host?.paneFolders ?? []),
    [host?.paneFolders, recent],
  );
  const cwd = folder.trim();
  const name = label.trim() || folderLabel(cwd);

  const setChoice = (patch: Partial<NewTaskChoice>) => {
    if (!agent) return;
    setChoices(current => ({ ...current, [agent]: { ...current[agent], ...patch } }));
  };

  /** Herdr and SFTP take absolute paths, so `~` becomes the remote home. */
  const resolve = async (native: HostRuntimeConnection, path: string) =>
    path === '~' || path.startsWith('~/') ? `${await native.remoteHome()}${path.slice(1)}` : path;

  const openFolder = async (path?: string) => {
    if (!host) return;
    const native = runtime(host.sessionId);
    if (!native) {
      setBrowse({ path: path ?? '', entries: null, error: 'The host is not connected.' });
      return;
    }
    try {
      const target = await resolve(native, path || cwd || '~');
      setBrowse({ path: target, entries: null, error: null });
      const listing = await native.listDirectory(target);
      const folders = listing.entries
        .filter(entry => entry.kind === 'directory' && !entry.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));
      setBrowse({ path: listing.path, entries: folders, error: null });
    } catch (reason) {
      setBrowse(current => ({
        path: current?.path ?? path ?? '',
        entries: null,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  };

  const create = async () => {
    if (!host) return;
    if (!cwd) {
      setError('Choose a folder for the task.');
      return;
    }
    const native = runtime(host.sessionId);
    if (!native) {
      setError('The host is not connected.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const path = await resolve(native, cwd);
      await onCreate(host.sessionId, name, path, launchFor(pane, choice));
      // Remembering is a convenience; a failure here must not undo the task.
      reportBackgroundFailure(
        rememberNewTask(host.hostId, path, agent ?? undefined, agent ? choice : undefined),
        'new-task-preferences',
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <View style={s.bar}>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
          <Text style={s.heading} accessibilityRole="header">New task</Text>
          <Pressable onPress={() => { void create(); }} disabled={creating || !host} accessibilityRole="button" hitSlop={8}>
            <Text style={[s.start, (creating || !cwd) && s.dim]}>{creating ? 'Starting' : 'Start'}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {error ? <Text style={s.error}>{error}</Text> : null}
          {!host && <Text style={s.hint}>Connect a host with Herdr turned on to start a task.</Text>}

          {hosts.length > 1 && (
            <Field label="Host" s={s}>
              <Chips
                options={hosts.map(candidate => ({ value: candidate.sessionId, label: candidate.hostName }))}
                value={host?.sessionId ?? ''}
                onChange={next => {
                  setSessionId(next);
                  setBrowse(null);
                }}
                s={s}
              />
            </Field>
          )}

          <Field label="Folder" s={s}>
            <View style={s.inline}>
              <TextInput
                style={[s.input, s.grow]}
                value={folder}
                onChangeText={setFolder}
                placeholder="~/Documents/Github/project"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => { if (browse) setBrowse(null); else void openFolder(); }}
                accessibilityRole="button"
                accessibilityState={{ expanded: browse !== null }}
                style={({ pressed }) => [s.quiet, pressed && s.pressed]}
              >
                <Text style={s.quietLabel}>{browse ? 'Done' : 'Browse'}</Text>
              </Pressable>
            </View>
            {browse ? (
              <FolderBrowser
                browse={browse}
                s={s}
                palette={palette}
                onOpen={path => { void openFolder(path); }}
                onUse={path => {
                  setFolder(path);
                  setBrowse(null);
                }}
              />
            ) : (
              suggestions.map(path => (
                <Pressable
                  key={path}
                  onPress={() => setFolder(path)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: path === cwd }}
                  style={({ pressed }) => [s.suggestion, pressed && s.pressed]}
                >
                  <Text style={[s.suggestionText, path === cwd && s.suggestionActive]} numberOfLines={1}>{path}</Text>
                </Pressable>
              ))
            )}
          </Field>

          <Field label="First pane" s={s}>
            <View style={s.segment} accessibilityRole="radiogroup">
              {PANES.map(option => {
                const active = pane === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setPane(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[s.segmentItem, active && s.segmentActive]}
                  >
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          {agent && (
            <>
              <Field label="Model" s={s}>
                <Chips
                  options={[
                    { value: '', label: 'Default' },
                    ...AGENTS[agent].models.map(model => ({ value: model, label: model })),
                    { value: '\0other', label: 'Other' },
                  ]}
                  value={customModel ? '\0other' : choice.model}
                  onChange={next => {
                    if (next === '\0other') {
                      setCustomModel(true);
                      setChoice({ model: '' });
                    } else {
                      setCustomModel(false);
                      setChoice({ model: next });
                    }
                  }}
                  s={s}
                />
                {customModel && (
                  <TextInput
                    style={s.input}
                    value={choice.model}
                    onChangeText={model => setChoice({ model })}
                    placeholder="Model ID"
                    placeholderTextColor={palette.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Effort" s={s}>
                <Chips
                  options={[{ value: '', label: 'Default' }, ...AGENTS[agent].efforts.map(effort => ({ value: effort, label: effort }))]}
                  value={choice.effort}
                  onChange={effort => setChoice({ effort })}
                  s={s}
                />
              </Field>
            </>
          )}

          <Field label="Workspace name" hint="Leave empty to use the folder name." s={s}>
            <TextInput
              style={s.input}
              value={label}
              onChangeText={setLabel}
              placeholder={folderLabel(cwd) || 'project'}
              placeholderTextColor={palette.muted}
              autoCorrect={false}
            />
          </Field>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function FolderBrowser({ browse, s, palette, onOpen, onUse }: {
  browse: Browse;
  s: Styles;
  palette: Palette;
  onOpen: (path: string) => void;
  onUse: (path: string) => void;
}) {
  const root = browse.path === '/' || browse.path === '';
  return (
    <View style={s.browser}>
      <View style={s.inline}>
        <Text style={[s.browserPath, s.grow]} numberOfLines={2}>{browse.path || 'Home'}</Text>
        <Pressable
          onPress={() => onUse(browse.path)}
          disabled={!browse.path}
          accessibilityRole="button"
          style={({ pressed }) => [s.solid, pressed && s.solidPressed, !browse.path && s.dim]}
        >
          <Text style={s.solidLabel}>Use this folder</Text>
        </Pressable>
      </View>
      {!root && (
        <Pressable onPress={() => onOpen(parentFolder(browse.path))} accessibilityRole="button" style={({ pressed }) => [s.entry, pressed && s.pressed]}>
          <Text style={s.entryText}>‹ Up</Text>
        </Pressable>
      )}
      {browse.error ? <Text style={s.hint}>Could not list this folder: {browse.error}</Text> : null}
      {!browse.error && browse.entries === null && <ActivityIndicator color={palette.muted} style={s.loading} />}
      {browse.entries?.length === 0 && <Text style={s.hint}>No folders in here.</Text>}
      {browse.entries?.map(entry => (
        <Pressable key={entry.path} onPress={() => onOpen(entry.path)} accessibilityRole="button" style={({ pressed }) => [s.entry, pressed && s.pressed]}>
          <Text style={s.entryText} numberOfLines={1}>{entry.name}/</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chips({ options, value, onChange, s }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  s: Styles;
}) {
  return (
    <View style={s.chips} accessibilityRole="radiogroup">
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [s.chip, active && s.chipActive, pressed && !active && s.pressed]}
          >
            <Text style={[s.chipLabel, active && s.chipLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({ label, hint, s, children }: { label: string; hint?: string; s: Styles; children: ReactNode }) {
  return (
    <View style={s.field}>
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
    start: { ...type.bodyBold, color: p.text },
    dim: { opacity: 0.45 },
    form: { padding: space.xl, gap: space.xl, paddingBottom: 64 },
    error: { ...type.body, color: p.text, padding: space.md, borderRadius: radius.sm, backgroundColor: p.surface },
    field: { gap: space.sm },
    label: { ...type.caption, color: p.muted },
    hint: { ...type.caption, color: p.muted },
    inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    grow: { flex: 1 },
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
    quiet: { paddingVertical: 11, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    quietLabel: { ...type.bodyMedium, color: p.text },
    pressed: { backgroundColor: p.surface },
    solid: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
    suggestion: { paddingVertical: space.sm, paddingHorizontal: space.sm, marginHorizontal: -space.sm, borderRadius: 8 },
    suggestionText: { ...type.body, color: p.muted },
    suggestionActive: { color: p.text, fontFamily: fonts.medium },
    browser: { gap: 2, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    browserPath: { ...type.caption, color: p.text, paddingHorizontal: space.xs },
    entry: { paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: 8 },
    entryText: { ...type.body, color: p.text },
    loading: { paddingVertical: space.md },
    segment: { flexDirection: 'row', padding: 3, borderRadius: radius.sm, backgroundColor: p.surface },
    segmentItem: { flex: 1, paddingVertical: space.sm, borderRadius: 8, alignItems: 'center' },
    segmentActive: { backgroundColor: p.bg },
    segmentLabel: { ...type.bodyMedium, color: p.muted },
    segmentLabelActive: { color: p.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: { paddingVertical: 6, paddingHorizontal: space.md, borderRadius: 999, borderWidth: 1.5, borderColor: p.seam },
    chipActive: { backgroundColor: p.text, borderColor: p.text },
    chipLabel: { ...type.bodyMedium, color: p.text },
    chipLabelActive: { color: p.bg },
  });
}
