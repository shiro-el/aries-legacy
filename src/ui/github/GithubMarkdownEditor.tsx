import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatGithubComment, type RuntimeGithubCommentFormat } from 'react-native-whip-ssh';
import { GithubMarkdown } from './GithubMarkdown';
import { GithubButton } from './parts';
import { useGithubStyles } from './styles';

const FORMATS: readonly RuntimeGithubCommentFormat[] = ['bold', 'italic', 'code', 'quote', 'bulletList', 'taskList', 'link'];
export function GithubMarkdownEditor({ value, onChange, disabled, onOpenLink }: {
  value: string; onChange: (value: string) => void; disabled: boolean; onOpenLink: (url: string) => void;
}) {
  const { t } = useTranslation();
  const { s, palette } = useGithubStyles();
  const [preview, setPreview] = useState(false);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const input = useRef<TextInputInstance>(null);
  const format = (kind: RuntimeGithubCommentFormat) => {
    const edit = formatGithubComment(value, { start: Math.min(selection.start, value.length), end: Math.min(selection.end, value.length) }, kind);
    if (edit.text.length > 65_536) return;
    onChange(edit.text);
    setSelection(edit.selection);
    input.current?.focus();
  };
  return <View style={s.editor}>
    <View style={s.editorBar} accessibilityRole="tablist">
      {(['write', 'preview'] as const).map(mode => <GithubButton key={mode} label={t(`github.${mode}`)} selected={preview === (mode === 'preview')}
        disabled={disabled} onPress={() => setPreview(mode === 'preview')} />)}
    </View>
    {preview ? <View style={s.preview}>
      {value.trim() ? <GithubMarkdown text={value} onOpenLink={onOpenLink} /> : <Text style={s.muted}>{t('github.nothingPreview')}</Text>}
    </View> : <>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {FORMATS.map(id => <View key={id}>
          <GithubButton label={t(`github.format.${id}`)} disabled={disabled} onPress={() => format(id)} />
        </View>)}
      </ScrollView>
      <TextInput ref={input} accessibilityLabel={t('github.replyPlaceholder')} placeholder={t('github.replyPlaceholder')}
        placeholderTextColor={palette.muted} style={s.draft} multiline maxLength={65_536} editable={!disabled} value={value}
        selection={{ start: Math.min(selection.start, value.length), end: Math.min(selection.end, value.length) }}
        onChangeText={onChange} onSelectionChange={event => setSelection(event.nativeEvent.selection)} />
    </>}
    <Text style={s.hint}>{t('github.markdownSupported')}</Text>
  </View>;
}
