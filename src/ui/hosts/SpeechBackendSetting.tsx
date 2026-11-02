import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deviceLanguage } from '../../i18n';
import { getSpeechPlayback, speechBackendCommand, systemSpeechVoices, type SpeechVoice, type SpeechBackendAction, type SpeechBackendStatus } from '../../services/speechPlayback';
import { formatRemoteFileSize } from '../../lib/remoteFiles';
import { bestEffortCleanup, reportBackgroundFailure } from '../../services/backgroundOperations';
import { SpeechVoicePicker } from './SpeechVoicePicker';
import type { DevicePreferencesController } from '../../hooks/useDevicePreferences';
import { usePalette } from '../theme/tokens';
import { SpeechAction, useSpeechStyles } from './SpeechControls';
import { useAppActive } from '../../hooks/useAppActive';

async function stopPreviewPlayback(owner: string) {
  await getSpeechPlayback().stopAnnouncement(owner);
}

const PREVIEW_TEXT_SAVE_DELAY_MS = 500;

export function SpeechBackendSetting({ ttsEnabled, onChange }: {
  ttsEnabled: boolean;
  onChange: DevicePreferencesController['setPreference'];
}) {
  const appActive = useAppActive();
  const palette = usePalette();
  const s = useSpeechStyles();
  const { t } = useTranslation();
  const [status, setStatus] = useState<SpeechBackendStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const [systemVoices, setSystemVoices] = useState<SpeechVoice[]>();
  const [voicesLoading, setVoicesLoading] = useState(false);
  const voicesLoadingRef = useRef(false);
  const [voicesError, setVoicesError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const previewOwner = useRef(`voice-preview-${Date.now()}`);
  const previewSequence = useRef(0);
  const [previewText, setPreviewText] = useState('');
  const previewTextRef = useRef('');
  const previewTextInitialized = useRef(false);
  const previewTextEdited = useRef(false);
  const [previewTextReady, setPreviewTextReady] = useState(false);
  const [previewTextError, setPreviewTextError] = useState<string>();
  const previewTextTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const savePreviewText = useCallback(() => {
    if (previewTextTimer.current) clearTimeout(previewTextTimer.current);
    previewTextTimer.current = undefined;
    if (!previewTextEdited.current) return;
    const text = previewTextRef.current;
    const save = async () => {
      try {
        await speechBackendCommand(`preview-text:${JSON.stringify(text)}`);
        if (mounted.current && previewTextRef.current === text) {
          setPreviewTextError(undefined);
          previewTextEdited.current = false;
        }
      } catch (failure) {
        if (mounted.current && previewTextRef.current === text) {
          setPreviewTextError(failure instanceof Error ? failure.message : String(failure));
        }
        throw failure;
      }
    };
    reportBackgroundFailure(save(), 'speech-preview-text-save');
  }, []);

  const loadSystemVoices = useCallback(async () => {
    if (voicesLoadingRef.current) return;
    voicesLoadingRef.current = true;
    setVoicesLoading(true);
    setVoicesError(undefined);
    try {
      const voices = await systemSpeechVoices();
      if (mounted.current) setSystemVoices(voices);
    } catch (failure) {
      if (mounted.current) setVoicesError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      voicesLoadingRef.current = false;
      if (mounted.current) setVoicesLoading(false);
    }
  }, []);

  const stopPreview = useCallback(() => {
    previewSequence.current += 1;
    bestEffortCleanup(stopPreviewPlayback(previewOwner.current), 'voice-preview-stop');
    setPreviewing(false);
  }, []);

  const changePreviewText = (text: string) => {
    previewTextEdited.current = true;
    previewTextRef.current = text;
    setPreviewText(text);
    if (previewing) stopPreview();
    if (previewTextTimer.current) clearTimeout(previewTextTimer.current);
    previewTextTimer.current = setTimeout(savePreviewText, PREVIEW_TEXT_SAVE_DELAY_MS);
  };

  const run = useCallback(async (action: SpeechBackendAction) => {
    if (action === 'status' && inFlight.current) return;
    inFlight.current = true;
    const id = ++request.current;
    if (action !== 'status') { stopPreview(); setBusy(true); }
    try {
      const value = await speechBackendCommand(action);
      if (mounted.current && request.current === id) {
        setStatus(value);
        setError(undefined);
      }
    } catch (failure) {
      if (mounted.current && request.current === id) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (request.current === id) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, [stopPreview]);
  useEffect(() => {
    mounted.current = true;
    void loadSystemVoices();
    const owner = previewOwner.current;
    return () => {
      mounted.current = false; request.current += 1; inFlight.current = false;
      savePreviewText();
      bestEffortCleanup(stopPreviewPlayback(owner), 'voice-preview-unmount');
    };
  }, [loadSystemVoices, run, savePreviewText]);
  useEffect(() => {
    if (appActive) void run('status');
  }, [appActive, run]);
  useEffect(() => {
    if (!appActive || (!status?.downloading && !status?.voiceDownload) || busy) return;
    const timer = setInterval(() => { void run('status'); }, 500);
    return () => clearInterval(timer);
  }, [appActive, status, busy, run]);

  const downloadSize = status ? formatRemoteFileSize(status.totalBytes) : '…';
  const progress = status ? Math.min(100, Math.floor(status.downloadedBytes * 100 / Math.max(1, status.totalBytes))) : 0;
  const phononVoices = [{ id: 'default', name: t('speech.defaultVoice'), language: 'en', installed: true }, ...(status?.voices ?? [])];
  const installedSystemVoices = [{ id: '', name: t('speech.systemDefault'), language: '' }, ...(systemVoices ?? [])];
  const voiceBusy = busy || !!status?.voiceDownload;
  const previewLanguage = status?.backend === 'phonon' ? 'en-US' : systemVoices?.find(voice => voice.id === status?.systemVoice)?.language ?? '';
  const defaultPreviewText = t('speech.previewText', { lng: status?.backend === 'phonon' ? 'en' : previewLanguage || deviceLanguage() });
  useEffect(() => {
    if (!status || previewTextInitialized.current) return;
    previewTextInitialized.current = true;
    const text = status.previewText ?? defaultPreviewText;
    previewTextRef.current = text;
    setPreviewText(text);
    setPreviewTextReady(true);
  }, [status, defaultPreviewText]);

  const preview = async () => {
    if (previewing) { stopPreview(); return; }
    if (!previewTextRef.current.trim()) return;
    savePreviewText();
    const sequence = ++previewSequence.current;
    setPreviewing(true);
    setError(undefined);
    try {
      const result = await getSpeechPlayback().speakPreview(previewOwner.current, previewTextRef.current, previewLanguage);
      if (result === 'busy' && mounted.current && previewSequence.current === sequence) setError(t('speech.previewBusy'));
    } catch (failure) {
      if (mounted.current && previewSequence.current === sequence) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (mounted.current && previewSequence.current === sequence) setPreviewing(false); }
  };
  return <View style={s.section}>
    <Text style={s.title} accessibilityRole="header">{t('speech.backend')}</Text>
    <View style={s.row}>
      <View style={s.grow}>
        <Text style={s.label}>{t('settings.speakChanges')}</Text>
        <Text style={s.hint}>{t('settings.speakChangesCopy')}</Text>
      </View>
      <Switch value={ttsEnabled} onValueChange={next => onChange('ttsEnabled', next)}
        accessibilityLabel={t('settings.speakChanges')} trackColor={{ true: palette.text, false: palette.seam }} thumbColor={palette.bg} />
    </View>
    <Text style={s.hint}>{t('speech.localCopy')}</Text>
    <View style={s.row} accessibilityRole="radiogroup">
      <SpeechAction label={t('speech.system')} radio selected={status?.backend === 'system'} disabled={busy || !status}
        onPress={() => { void run('system'); }} />
      <SpeechAction label={t('speech.phonon')} radio selected={status?.backend === 'phonon'}
        disabled={busy || !status?.supported || !status.installed} onPress={() => { void run('phonon'); }} />
    </View>
    <View style={s.nested}>
      {status?.backend === 'system' ? <SpeechVoicePicker title={t('speech.systemVoice')} selected={status.systemVoice}
        voices={installedSystemVoices} disabled={busy} loading={voicesLoading} error={voicesError}
        onOpen={() => { if (!systemVoices) void loadSystemVoices(); }}
        onSelect={id => { void run(`system-voice:${id}`); }} /> : null}
      {status?.backend === 'phonon' ? <SpeechVoicePicker title={t('speech.phononVoice')} selected={status.voice}
        voices={phononVoices} disabled={voiceBusy || !status.installed} onSelect={id => { void run(`voice:${id}`); }}
        onRemove={id => { void run(`remove-voice:${id}`); }} /> : null}
    </View>
    <Text style={s.label}>{t('speech.previewTextLabel')}</Text>
    <TextInput value={previewText} onChangeText={changePreviewText} onBlur={savePreviewText}
      accessibilityLabel={t('speech.previewTextLabel')} editable={previewTextReady}
      style={[s.input, s.previewInput]} multiline textAlignVertical="top" maxLength={status?.maxTextUnits} />
    <SpeechAction label={t(previewing ? 'speech.stopPreview' : 'speech.preview')}
      disabled={busy || !status || !!status.voiceDownload || !previewTextReady || !previewText.trim()}
      onPress={() => { void preview(); }} />
    {status?.voiceDownload ? <>
      <Text accessibilityLiveRegion="polite" style={s.hint}>{t('speech.voiceProgress', {
        name: status.voices.find(voice => voice.id === status.voiceDownload?.id)?.name,
        progress: Math.min(100, Math.floor(status.voiceDownload.downloadedBytes * 100 / Math.max(1, status.voiceDownload.totalBytes))),
      })}</Text>
      <SpeechAction label={t('common.cancel')} disabled={busy} onPress={() => { void run('cancel'); }} />
    </> : null}
    {status?.supported ? <>
      <Text accessibilityLiveRegion="polite" style={s.hint}>{status.installed
        ? t('speech.installed', { size: downloadSize })
        : status.downloading ? t('speech.progress', { progress, size: downloadSize })
          : t('speech.downloadSize', { size: downloadSize })}</Text>
      {!status.installed ? <Text style={s.hint}>{t('speech.storage', { size: formatRemoteFileSize(status.requiredStorageBytes) })}</Text> : null}
      {status.downloading ? <SpeechAction label={t('common.cancel')} disabled={busy} onPress={() => { void run('cancel'); }} />
        : !status.installed ? <SpeechAction label={t(status.downloadedBytes > 0 ? 'speech.resume' : 'speech.download')}
          disabled={busy} onPress={() => { void run('download'); }} /> : null}
      {!status.downloading && !status.voiceDownload && (status.installed || status.downloadedBytes > 0)
        ? <SpeechAction label={t('speech.remove')} disabled={busy} onPress={() => { void run('delete'); }} /> : null}
    </> : status ? <Text style={s.hint}>{t('speech.unsupported')}</Text> : null}
    {previewTextError || error || status?.error || status?.fallback
      ? <Text accessibilityLiveRegion="polite" style={s.error}>{previewTextError ?? error ?? status?.error ?? status?.fallback}</Text> : null}
    {error ? <SpeechAction label={t('speech.retry')} disabled={busy} onPress={() => { void run('status'); }} /> : null}
  </View>;
}
