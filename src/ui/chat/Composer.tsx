import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Mic, Plus } from 'lucide-react-native';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
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
import { AttachSheet } from './AttachSheet';
import { SkillSheet } from './SkillSheet';
import type { PolishPassage } from '../../services/transcriptPolish';
import { useComposerImages, useImagePaste, type ComposerImageSource } from './useComposerImages';
import { useDictatedPassage } from './useDictatedPassage';
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
  /** Sends the text and the host paths of the attached images. */
  onSend: (text: string, images: readonly string[]) => Promise<void>;
  onOpenTerminal: () => void;
  voice?: ComposerVoice;
  /** Pasted images; a composer without it takes text only. */
  images?: ComposerImageSource;
  /** Each new value focuses the input, e.g. to type an answer to a question. */
  focusRequest?: number;
};

/**
 * Messages to the agent. `/` at the start lists the agent's own commands;
 * skills sit behind + with the photos, so the two never share one list.
 */
export function Composer({
  name, agent, catalogSource, paneContext, active, disabled, autoFocus, palette, onSend, onOpenTerminal, voice, images, focusRequest,
}: Props) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [text, setText] = useState('');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  // Set only right after an insertion, then handed back to the input.
  const [placed, setPlaced] = useState<Selection | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const attached = useComposerImages(images, setError);
  const paste = useImagePaste(images, attached.addPasted, setError);
  useEffect(() => {
    if (focusRequest) paste.ref.current?.focus();
  }, [focusRequest, paste.ref]);
  const canSend = (draft: string) => !disabled && !sending && !attached.uploading
    && (draft.trim().length > 0 || attached.paths.length > 0);
  const ready = canSend(text);
  // Set by the recording bar's send: the transcript goes out as soon as it lands.
  const sendOnText = useRef(false);

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
        if (sendOnText.current) {
          sendOnText.current = false;
          void sendRef.current();
        }
      },
    });
    // Dictating again withdraws Polish and Original from the previous passage.
    if (result === 'started') dictated.end();
    else if (result !== 'busy') setVoiceNotice(result);
  };
  const phase = dictation.snapshot.phase;
  // A failed transcript waits for Retry or Discard, so it is never sent unseen.
  useEffect(() => {
    if (phase === 'failed' || phase === 'idle') sendOnText.current = false;
  }, [phase]);
  const stopAndSend = () => {
    sendOnText.current = true;
    void dictation.input.stop();
  };
  const shownNotice = dictation.snapshot.phase === 'failed' ? dictation.snapshot.error : voiceNotice;

  const pickCommand = (command: AgentCatalogEntry) => apply(insertCommand(text, command.name));
  const pickSkill = (skill: AgentCatalogEntry) => {
    setSkillsOpen(false);
    apply(insertToken(text, selection, skillToken(agent, skill.name)));
  };

  const send = async () => {
    // Read the latest draft: a transcript can arrive between renders.
    const message = latest.current.text.trimEnd();
    if (!canSend(message)) return;
    const menu = terminalOnlyCommand(message, commands);
    setSending(true);
    setError(null);
    try {
      await onSend(message, attached.paths);
      attached.clear();
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
  const sendRef = useRef(send);
  sendRef.current = send;

  const recording = dictation.snapshot.phase === 'recording';

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
      {/* The input stays mounted under the recording bar, so the keyboard stays up. */}
      <View>
        <View
          style={s.box}
          importantForAccessibility={recording ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={recording}
        >
          {attached.images.length > 0 && (
            <ScrollView horizontal contentContainerStyle={s.images} keyboardShouldPersistTaps="always">
              {attached.images.map((image, index) => (
                <View key={image.id} style={s.image}>
                  {image.previewUri
                    ? <Image source={{ uri: image.previewUri }} style={s.imagePreview} accessibilityLabel={`Image ${index + 1}`} />
                    : <ActivityIndicator color={palette.muted} accessibilityLabel={`Uploading image ${index + 1}`} />}
                  <Pressable
                    onPress={() => attached.remove(image.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove image ${index + 1}`}
                    hitSlop={8}
                    style={s.imageRemove}
                  >
                    <Text style={s.imageRemoveLabel}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          <TextInput
            ref={paste.ref}
            onLayout={paste.onLayout}
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
          <View style={s.actions}>
            <Pressable
              onPress={() => setMenuOpen(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Add photos or skills"
              accessibilityState={{ expanded: menuOpen }}
              style={({ pressed }) => [s.round, pressed && s.roundPressed, disabled && s.dim]}
            >
              <Plus size={22} color={palette.text} />
            </Pressable>
            <View style={s.grow} />
            {voice && (
              <Pressable
                onPress={() => { void record(); }}
                disabled={disabled || phase === 'transcribing'}
                accessibilityRole="button"
                accessibilityLabel="Record voice"
                style={({ pressed }) => [s.round, pressed && s.roundPressed, (disabled || phase === 'transcribing') && s.dim]}
              >
                <Mic size={20} color={palette.text} />
              </Pressable>
            )}
            <Pressable
              onPress={() => { void send(); }}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !ready, busy: sending }}
              style={({ pressed }) => [s.send, !ready && s.dim, pressed && s.sendPressed]}
            >
              {sending ? <ActivityIndicator color={palette.bg} /> : <ArrowUp size={22} color={palette.bg} strokeWidth={2.5} />}
            </Pressable>
          </View>
        </View>
        {dictation.snapshot.phase === 'recording' && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={s.overlay}>
            <RecordingBar
              input={dictation.input}
              startedAt={dictation.snapshot.startedAt}
              palette={palette}
              onSend={stopAndSend}
            />
          </Animated.View>
        )}
      </View>
      <AttachSheet
        visible={menuOpen}
        name={name}
        photos={images !== undefined}
        palette={palette}
        onCamera={() => { void attached.pick('camera'); }}
        onPhotos={() => { void attached.pick('photo'); }}
        onSkills={() => setSkillsOpen(true)}
        onClose={() => setMenuOpen(false)}
      />
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

const ROUND = 40;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    composer: {
      paddingHorizontal: space.md,
      paddingTop: space.sm,
      paddingBottom: space.sm,
      gap: space.xs,
    },
    suggestions: { maxHeight: 232, marginBottom: space.xs },
    suggestion: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: 8, gap: 2 },
    suggestionHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    command: { ...type.bodyBold, color: p.text, flexShrink: 1 },
    hint: { ...type.caption, fontFamily: fonts.regular, color: p.muted },
    tag: { ...type.caption, color: p.muted, marginLeft: 'auto' },
    pressed: { backgroundColor: p.seam },
    dim: { opacity: 0.4 },
    grow: { flex: 1 },
    error: { ...type.caption, color: p.text, paddingHorizontal: space.xs },
    box: {
      borderRadius: 26,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: p.seam,
      backgroundColor: p.surface,
      paddingTop: space.sm,
      paddingBottom: space.sm,
      paddingHorizontal: space.sm,
      gap: space.xs,
    },
    overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    input: {
      ...type.body,
      maxHeight: 160,
      minHeight: 40,
      color: p.text,
      paddingHorizontal: space.sm,
      paddingTop: space.sm,
      paddingBottom: space.xs,
      textAlignVertical: 'top',
    },
    actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    round: {
      width: ROUND,
      height: ROUND,
      borderRadius: ROUND / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.bg,
    },
    roundPressed: { backgroundColor: p.seam },
    send: {
      width: ROUND,
      height: ROUND,
      borderRadius: ROUND / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.text,
    },
    sendPressed: { opacity: 0.85 },
    images: { gap: space.sm, paddingHorizontal: space.xs, paddingTop: space.xs },
    image: {
      width: 64,
      height: 64,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.bg,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    imagePreview: { width: '100%', height: '100%' },
    imageRemove: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: p.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imageRemoveLabel: { ...type.caption, color: p.bg, lineHeight: 16 },
  });
}
