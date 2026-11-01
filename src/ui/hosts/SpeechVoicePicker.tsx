import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatRemoteFileSize } from '../../lib/remoteFiles';
import { hapticPress } from '../../services/interactionFeedback';
import type { SpeechVoice } from '../../services/speechPlayback';
import { SpeechAction, useSpeechStyles } from './SpeechControls';

interface Props {
  title: string;
  selected: string;
  voices: SpeechVoice[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onOpen?: () => void;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
}

export function SpeechVoicePicker({ title, selected, voices, disabled, loading, error, onOpen, onSelect, onRemove }: Props) {
  const { t } = useTranslation();
  const s = useSpeechStyles();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = voices.find(voice => voice.id === selected);
  const query = search.trim().toLocaleLowerCase();
  const filtered = voices.filter(voice => `${voice.name} ${voice.language} ${voice.description ?? ''}`.toLocaleLowerCase().includes(query));
  const close = () => setOpen(false);

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} style={({ pressed }) => [s.voice, disabled && s.disabled, pressed && s.pressed]}
      onPress={hapticPress(() => { setSearch(''); setOpen(true); onOpen?.(); })}>
      <Text style={s.hint}>{title}</Text>
      <Text style={s.label}>{current?.name ?? t(loading ? 'speech.voicesLoading' : 'speech.voiceUnavailable')}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <Pressable style={s.dismiss} accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={close} />
        <View style={s.modal} accessibilityViewIsModal>
          <View style={s.row}>
            <Text style={[s.title, s.grow]} accessibilityRole="header">{title}</Text>
            <SpeechAction label={t('common.cancel')} onPress={close} />
          </View>
          <TextInput value={search} onChangeText={setSearch} placeholder={t('speech.searchVoices')}
            accessibilityLabel={t('speech.searchVoices')} style={s.input} autoCorrect={false} autoCapitalize="none" />
          {loading ? <Text style={s.hint}>{t('speech.voicesLoading')}</Text> : null}
          {error ? <>
            <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>
            <SpeechAction label={t('speech.retry')} disabled={loading} onPress={() => onOpen?.()} />
          </> : null}
          <FlatList data={filtered} keyExtractor={voice => voice.id} keyboardShouldPersistTaps="handled"
            ListEmptyComponent={!loading && !error ? <Text style={s.hint}>{t('speech.noVoices')}</Text> : undefined}
            renderItem={({ item: voice }) => <View style={s.voiceRow}>
              <Pressable accessibilityRole="radio" accessibilityLabel={voice.name}
                accessibilityState={{ selected: voice.id === selected, disabled: !!disabled }} disabled={disabled}
                style={({ pressed }) => [s.voice, voice.id === selected && s.selected, disabled && s.disabled, pressed && s.pressed]}
                onPress={hapticPress(() => { close(); onSelect(voice.id); })}>
                <Text style={s.label}>{voice.name}</Text>
                {voice.language ? <Text style={s.hint}>{voice.language}</Text> : null}
                {voice.description ? <Text style={s.hint} numberOfLines={2}>{voice.description}</Text> : null}
                {voice.bytes ? <Text style={s.hint}>{t(voice.installed ? 'speech.installed' : 'speech.downloadVoice', {
                  size: formatRemoteFileSize(voice.bytes),
                })}</Text> : null}
                {voice.networkRequired ? <Text style={s.hint}>{t('speech.networkVoice')}</Text> : null}
              </Pressable>
              {onRemove && voice.installed && voice.bytes ? <SpeechAction disabled={disabled}
                label={t('speech.removeVoice', { name: voice.name })} onPress={() => onRemove(voice.id)} /> : null}
            </View>} />
        </View>
      </View>
    </Modal>
  </>;
}
