import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Square, X } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { reportBackgroundFailure } from '../../services/backgroundOperations';
import type { TranscriptionFailure } from '../../services/groqTranscription';
import type { StartResult, VoiceInput, VoiceInputSnapshot } from '../../services/voiceInput';
import { createVoiceInput } from '../../services/voiceRecorder';
import type { DictatedPassage } from './useDictatedPassage';
import { space, type, type Palette } from '../theme/tokens';

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
  permissionDenied: 'Aries needs the microphone for voice input. Tap the microphone to allow it, or allow it in Android settings.',
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
// More than fit: the oldest bars slide out past the left edge.
const WAVE_BARS = 64;

/** Stands in for the whole composer while the microphone is open. */
export function RecordingBar({ input, startedAt, palette, onSend }: {
  input: VoiceInput;
  startedAt: number;
  palette: Palette;
  /** Stops and sends the transcript once it arrives. */
  onSend: () => void;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={s.bar}>
      <Pressable
        onPress={() => { void input.cancel(); }}
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
        style={({ pressed }) => [s.round, pressed && s.roundPressed]}
      >
        <X size={20} color={palette.text} />
      </Pressable>
      <Wave input={input} startedAt={startedAt} s={s} />
      <Pressable
        onPress={() => { void input.stop(); }}
        accessibilityRole="button"
        accessibilityLabel="Stop recording"
        style={({ pressed }) => [s.round, pressed && s.roundPressed]}
      >
        <Square size={16} color={palette.text} fill={palette.text} />
      </Pressable>
      <Pressable
        onPress={onSend}
        accessibilityRole="button"
        accessibilityLabel="Send recording"
        style={({ pressed }) => [s.send, pressed && s.sendPressed]}
      >
        <ArrowUp size={22} color={palette.bg} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

/** The only part that changes while recording, so the buttons and icons stay put. */
function Wave({ input, startedAt, s }: { input: VoiceInput; startedAt: number; s: Styles }) {
  const [now, setNow] = useState(() => Date.now());
  // Starts empty and grows from the right edge, newest level last.
  const [levels, setLevels] = useState<readonly number[]>([]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      const db = input.level();
      const level = db === null ? 0 : Math.min(1, Math.max(0, (db - QUIET_DB) / -QUIET_DB));
      setLevels(current => [...current.slice(-(WAVE_BARS - 1)), level]);
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [input]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <>
      <View style={s.wave} accessibilityLabel={`Recording, ${elapsed}`}>
        {levels.map((level, index) => (
          <View key={index} style={[s.waveBar, { height: 4 + Math.round(level * 24) }]} />
        ))}
      </View>
      <Text style={s.elapsed}>{elapsed}</Text>
    </>
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
    // Fills the composer box it covers, corners and all.
    bar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      borderRadius: 26,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: p.seam,
      backgroundColor: p.surface,
      padding: space.sm,
    },
    round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg },
    roundPressed: { backgroundColor: p.seam },
    wave: { flex: 1, height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, overflow: 'hidden' },
    waveBar: { width: 3, borderRadius: 1.5, backgroundColor: p.text },
    elapsed: { ...type.caption, color: p.muted, fontVariant: ['tabular-nums'] },
    send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.text },
    sendPressed: { opacity: 0.85 },
  });
}
