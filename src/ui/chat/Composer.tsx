import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AgentCatalogEntry } from 'react-native-whip-ssh';
import { transcriptionContext } from 'react-native-whip-ssh/src/transcriptionContext';

import { useAgentCatalog, type AgentCatalogSource } from '../../hooks/useAgentCatalog';
import type { ChatAgent } from '../../lib/agentChatSession';
import { fonts, radius, space, type, type Palette } from '../theme/tokens';
import {
  insertCommand,
  insertToken,
  matchCommands,
  skillToken,
  slashQuery,
  terminalOnlyCommand,
  type Selection,
} from './composerCatalog';
import { transcriptionPrompt } from '../../services/groqTranscription';
import { PolishBar, RecordingBar, useVoiceInput, VoiceStatus, type VoiceNotice } from './ComposerVoice';
import { SkillSheet } from './SkillSheet';
import { useDictatedPassage, type PolishPassage } from './useDictatedPassage';
import { insertTranscript } from './voiceText';

/** Voice input for an agent's composer. Shell panes have none. */
export type ComposerVoice = {
  /** Recent chat text, newest last, for context words. */
  recentMessages: () => string[];
  /** Opens the phone's Groq key setting. */
  onNeedKey: () => void;
  /** Rewrites the latest transcript on the pane's host. */
  polish?: (passage: PolishPassage) => Promise<string>;
};

type Props = {
  name: string;
  agent: ChatAgent | null;
  /** The pane whose commands and skills to offer; null while offline. */
  catalogSource: AgentCatalogSource | null;
  /** Folder and agent, so a pane that changes either refreshes its list. */
  paneContext: string;
  active: boolean;
  disabled: boolean;
  autoFocus?: boolean;
  palette: Palette;
  onSend: (text: string) => Promise<void>;
  onOpenTerminal: () => void;
  voice?: ComposerVoice;
};

/**
 * Messages to the agent. `/` at the start lists the agent's own commands;
 * skills have a separate button so the two never share one list.
 */
export function Composer({
  name, agent, catalogSource, paneContext, active, disabled, autoFocus, palette, onSend, onOpenTerminal, voice,
}: Props) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [text, setText] = useState('');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  // Set only right after an insertion, then handed back to the input.
  const [placed, setPlaced] = useState<Selection | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<VoiceNotice | null>(null);
  const dictation = useVoiceInput(voice !== undefined && active);
  // A transcript lands where the caret is when it arrives, not when recording began.
  const latest = useRef({ text, selection });
  latest.current = { text, selection };

  const catalog = useAgentCatalog(catalogSource, active, paneContext);
  const commands = catalog.catalog?.commands ?? [];
  const skills = catalog.catalog?.skills ?? [];
  const query = slashQuery(text, selection.end);
  const suggestions = query === null ? [] : matchCommands(commands, query);
  const ready = !disabled && !sending && text.trim().length > 0;

  const apply = (next: { text: string; caret: number }) => {
    dictated.edited(latest.current.text, next.text);
    latest.current = { text: next.text, selection: { start: next.caret, end: next.caret } };
    setText(next.text);
    const caret = { start: next.caret, end: next.caret };
    setSelection(caret);
    setPlaced(caret);
  };
  const dictated = useDictatedPassage(voice?.polish, () => latest.current.text, apply);
  const edit = (next: string) => {
    dictated.edited(latest.current.text, next);
    latest.current = { ...latest.current, text: next };
    setText(next);
  };

  const record = async () => {
    if (!voice) return;
    setVoiceNotice(null);
    const { text: draft } = latest.current;
    const prompt = transcriptionPrompt(transcriptionContext(draft, voice.recentMessages()));
    const result = await dictation.input.start({
      prompt,
      onText: transcript => {
        const inserted = insertTranscript(latest.current.text, latest.current.selection, transcript);
        apply(inserted);
        dictated.dictated(inserted.range);
      },
    });
    if (result !== 'started' && result !== 'busy') setVoiceNotice(result);
  };
  const phase = dictation.snapshot.phase;
  const shownNotice = dictation.snapshot.phase === 'failed' ? dictation.snapshot.error : voiceNotice;

  const pickCommand = (command: AgentCatalogEntry) => apply(insertCommand(text, command.name));
  const pickSkill = (skill: AgentCatalogEntry) => {
    setSkillsOpen(false);
    apply(insertToken(text, selection, skillToken(agent, skill.name)));
  };

  const send = async () => {
    if (!ready) return;
    const message = text.trimEnd();
    const menu = terminalOnlyCommand(message, commands);
    setSending(true);
    setError(null);
    try {
      await onSend(message);
      dictated.end();
      latest.current = { text: '', selection: { start: 0, end: 0 } };
      setText('');
      setSelection({ start: 0, end: 0 });
      // This command opens a menu only the terminal can show.
      if (menu) onOpenTerminal();
    } catch (reason) {
      setError(`Not sent: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={s.composer}>
      {suggestions.length > 0 && (
        <ScrollView style={s.suggestions} keyboardShouldPersistTaps="always">
          {suggestions.map(command => (
            <Pressable
              key={command.name}
              onPress={() => pickCommand(command)}
              accessibilityRole="button"
              style={({ pressed }) => [s.suggestion, pressed && s.pressed]}
            >
              <View style={s.suggestionHead}>
                <Text style={s.command} numberOfLines={1}>
                  /{command.name}
                  {command.argumentHint ? <Text style={s.hint}> {command.argumentHint}</Text> : null}
                </Text>
                {command.terminalOnly && <Text style={s.tag}>Opens terminal</Text>}
              </View>
              {command.description ? <Text style={s.hint} numberOfLines={1}>{command.description}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {voice && (
        <VoiceStatus
          notice={shownNotice}
          failed={phase === 'failed'}
          transcribing={phase === 'transcribing'}
          palette={palette}
          onSetUpKey={() => { setVoiceNotice(null); voice.onNeedKey(); }}
          onRetry={() => { void dictation.input.retry(); }}
          onDiscard={() => dictation.input.discard()}
          onDismiss={() => setVoiceNotice(null)}
        />
      )}
      {dictated.passage && phase === 'idle' && (
        <PolishBar
          passage={dictated.passage}
          palette={palette}
          onPolish={() => { void dictated.polish(); }}
          onRestore={() => dictated.restore()}
        />
      )}
      {dictation.snapshot.phase === 'recording' ? (
        <RecordingBar input={dictation.input} startedAt={dictation.snapshot.startedAt} palette={palette} />
      ) : (
        <View style={s.row}>
          <Pressable
            onPress={() => setSkillsOpen(true)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${name} skills`}
            style={({ pressed }) => [s.quiet, pressed && s.pressed, disabled && s.dim]}
          >
            <Text style={s.quietLabel}>Skills</Text>
          </Pressable>
          <TextInput
            style={s.input}
            value={text}
            selection={placed}
            onChangeText={edit}
            onSelectionChange={event => {
              setSelection(event.nativeEvent.selection);
              if (placed) setPlaced(undefined);
            }}
            placeholder={`Message ${name}`}
            placeholderTextColor={palette.muted}
            multiline
            autoFocus={autoFocus}
            editable={!disabled}
          />
          {voice && (
            <Pressable
              onPress={() => { void record(); }}
              disabled={disabled || phase === 'transcribing'}
              accessibilityRole="button"
              accessibilityLabel="Record voice"
              style={({ pressed }) => [s.quiet, pressed && s.pressed, (disabled || phase === 'transcribing') && s.dim]}
            >
              <Text style={s.quietLabel}>Voice</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => { void send(); }}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [s.solid, !ready && s.dim, pressed && s.solidPressed]}
          >
            <Text style={s.solidLabel}>{sending ? 'Sending' : 'Send'}</Text>
          </Pressable>
        </View>
      )}
      <SkillSheet
        visible={skillsOpen}
        name={name}
        status={catalog.status}
        skills={skills}
        token={skill => skillToken(agent, skill)}
        palette={palette}
        onPick={pickSkill}
        onClose={() => setSkillsOpen(false)}
      />
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    composer: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.seam,
      gap: space.xs,
    },
    suggestions: { maxHeight: 232, marginBottom: space.xs },
    suggestion: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: 8, gap: 2 },
    suggestionHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    command: { ...type.bodyBold, color: p.text, flexShrink: 1 },
    hint: { ...type.caption, fontFamily: fonts.regular, color: p.muted },
    tag: { ...type.caption, color: p.muted, marginLeft: 'auto' },
    pressed: { backgroundColor: p.surface },
    dim: { opacity: 0.45 },
    error: { ...type.caption, color: p.text, paddingHorizontal: space.xs },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
    input: {
      ...type.body,
      flex: 1,
      maxHeight: 140,
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
    solid: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
  });
}
