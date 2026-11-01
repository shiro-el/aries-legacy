import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { reportBackgroundFailure } from '../../services/backgroundOperations';
import type { TranscriptionFailure } from '../../services/groqTranscription';
import type { StartResult, VoiceInput, VoiceInputSnapshot } from '../../services/voiceInput';
import { createVoiceInput } from '../../services/voiceRecorder';
import type { DictatedPassage } from './useDictatedPassage';
import { radius, space, type, type Palette } from '../theme/tokens';

/**
 * One voice input per composer. Leaving the screen closes the microphone but
 * keeps a failed recording, so Retry works after fixing the key in Hosts.
 */
export function useVoiceInput(visible: boolean): { input: VoiceInput; snapshot: VoiceInputSnapshot } {
  const [input] = useState(createVoiceInput);
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot);
  useEffect(() => {
    if (!visible) input.pause();
  }, [visible, input]);
  useEffect(() => () => input.dispose(), [input]);
  return { input, snapshot };
}

/** Why the microphone did not start, or why its recording did not become text. */
export type VoiceNotice = Exclude<StartResult, 'started' | 'busy'> | TranscriptionFailure;

const NOTICES: Record<VoiceNotice, string> = {
  noKey: 'Voice input needs a Groq API key.',
  permissionDenied: 'Aries needs the microphone for voice input. Tap Voice to allow it, or allow it in Android settings.',
  permissionBlocked: 'The microphone is turned off for Aries in Android settings.',
  recordingFailed: 'The microphone did not start. Another app may be using it.',
  unauthorized: 'Groq rejected the API key.',
  rateLimited: 'Groq rate limit reached. Try again in a moment.',
  network: 'Could not reach Groq.',
  failed: 'Groq could not transcribe the recording.',
};

export function VoiceStatus({ notice, failed, transcribing, palette, onSetUpKey, onRetry, onDiscard, onDismiss }: {
  notice: VoiceNotice | null;
  /** A kept recording can be sent again. */
  failed: boolean;
  transcribing: boolean;
  palette: Palette;
  onSetUpKey: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  const s = makeStyles(palette);
  if (transcribing) return <Text style={s.status}>Transcribing…</Text>;
  if (!notice) return null;
  return (
    <View style={s.notice}>
      <Text style={[s.status, s.grow]}>{NOTICES[notice]}</Text>
      {failed ? (
        <>
          {notice === 'unauthorized' && <Link label="Key" a11y="Set up Groq API key" onPress={onSetUpKey} s={s} />}
          <Link label="Retry" a11y="Retry transcription" onPress={onRetry} s={s} />
          <Link label="Discard" a11y="Discard recording" onPress={onDiscard} s={s} />
        </>
      ) : notice === 'noKey' ? (
        <Link label="Set up" a11y="Set up Groq API key" onPress={onSetUpKey} s={s} />
      ) : notice === 'permissionBlocked' || notice === 'permissionDenied' ? (
        <Link
          label="Settings"
          a11y="Open Android settings"
          onPress={() => reportBackgroundFailure(Linking.openSettings(), 'voice-input-settings')}
          s={s}
        />
      ) : (
        <Link label="OK" a11y="Dismiss voice notice" onPress={onDismiss} s={s} />
      )}
    </View>
  );
}

/** Polish for the newest transcript, and the way back to what was said. */
export function PolishBar({ passage, palette, onPolish, onRestore }: {
  passage: DictatedPassage;
  palette: Palette;
  onPolish: () => void;
  onRestore: () => void;
}) {
  const s = makeStyles(palette);
  return (
    <View style={s.notice}>
      <Text style={[s.status, s.grow]}>
        {passage.busy ? 'Polishing…' : passage.error ?? (passage.original === null ? 'Transcript added.' : 'Transcript polished.')}
      </Text>
      {!passage.busy && (passage.original === null
        ? <Link label="Polish" a11y="Polish transcript" onPress={onPolish} s={s} />
        : <Link label="Original" a11y="Restore original transcript" onPress={onRestore} s={s} />)}
    </View>
  );
}

const LEVEL_POLL_MS = 120;
const QUIET_DB = -60;

/** Stands in for the text field while the microphone is open. */
export function RecordingBar({ input, startedAt, palette }: {
  input: VoiceInput;
  startedAt: number;
  palette: Palette;
}) {
  const s = makeStyles(palette);
  const [now, setNow] = useState(() => Date.now());
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      const db = input.level();
      setLevel(db === null ? 0 : Math.min(1, Math.max(0, (db - QUIET_DB) / -QUIET_DB)));
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [input]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <View style={s.bar}>
      <Pressable
        onPress={() => { void input.cancel(); }}
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
        style={({ pressed }) => [s.quiet, pressed && s.pressed]}
      >
        <Text style={s.quietLabel}>Cancel</Text>
      </Pressable>
      <View style={s.meter} accessibilityLabel={`Recording, ${elapsed}`}>
        <View style={s.dot} />
        <Text style={s.elapsed}>{elapsed}</Text>
        <View style={s.track}>
          <View style={[s.fill, { width: `${Math.round(level * 100)}%` }]} />
        </View>
      </View>
      <Pressable
        onPress={() => { void input.stop(); }}
        accessibilityRole="button"
        accessibilityLabel="Stop recording"
        style={({ pressed }) => [s.solid, pressed && s.solidPressed]}
      >
        <Text style={s.solidLabel}>Stop</Text>
      </Pressable>
    </View>
  );
}

function Link({ label, a11y, onPress, s }: { label: string; a11y: string; onPress: () => void; s: Styles }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6} style={({ pressed }) => [s.link, pressed && s.pressed]}>
      <Text style={s.linkLabel}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    status: { ...type.caption, color: p.muted, paddingHorizontal: space.xs },
    notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    grow: { flex: 1 },
    link: { paddingVertical: 2, paddingHorizontal: space.xs, borderRadius: 6 },
    linkLabel: { ...type.caption, color: p.text, textDecorationLine: 'underline' },
    pressed: { backgroundColor: p.surface },
    bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    meter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: 11,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: p.text },
    elapsed: { ...type.bodyMedium, color: p.text },
    track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: p.seam, overflow: 'hidden' },
    fill: { height: 4, backgroundColor: p.text },
    quiet: { paddingVertical: 11, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    quietLabel: { ...type.bodyMedium, color: p.text },
    solid: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
  });
}
