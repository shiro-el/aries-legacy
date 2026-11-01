import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BackHandler, FlatList, Pressable, Text, TextInput, View, type FlatList as FlatListType } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import type { RuntimeGithubEntry, RuntimeGithubListState } from 'react-native-whip-ssh';
import { githubDetailsQueryOptions, githubPageQueryOptions } from '../../services/remoteGithubQueries';
import { GithubDetail } from './GithubDetail';
import { GithubPagination } from './GithubPagination';
import { retryGithubPage } from './pagination';
import { GitHubMark, GithubButton, GithubEntryState, GithubStatus } from './parts';
import { useGithubStyles } from './styles';
import type { GithubRequest, GithubSection } from './types';

export function GithubViewer({ connection, repository, active, onClose }: GithubRequest & { onClose: () => void }) {
  const { t } = useTranslation();
  const { s, palette } = useGithubStyles();
  const [section, setSection] = useState<GithubSection>('issues');
  const [state, setState] = useState<RuntimeGithubListState>('open');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RuntimeGithubEntry | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const list = useRef<FlatListType<RuntimeGithubEntry>>(null);
  const connected = active && connection.isCurrent();
  const details = useQuery({ ...githubDetailsQueryOptions(connection, repository), enabled: connected });
  const page = useInfiniteQuery({ ...githubPageQueryOptions(connection, repository, section, state, search), enabled: connected && !selected });
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) {
        if (selected) setSelected(null);
        else onClose();
      }
      return true;
    });
    return () => subscription.remove();
  }, [active, selected, busy, onClose]);
  const openLink = (url: string) => {
    setLinkError(null);
    // Markdown links are untrusted; only web links open outside the app.
    if (!/^https?:\/\//i.test(url)) { setLinkError(t('github.webLinksOnly')); return; }
    void WebBrowser.openBrowserAsync(url).catch((reason: unknown) => setLinkError(reason instanceof Error ? reason.message : String(reason)));
  };
  const key = `${section}:${selected?.id ?? ''}`;
  const setDraft = (name: string, value: string) => setDrafts(current => ({ ...current, [name]: value }));
  return <KeyboardAvoidingView style={s.fill} behavior="padding">
    <View style={s.header}>
      <View style={s.between}>
        <GitHubMark />
        <Text style={[s.strong, s.fill]} numberOfLines={1}>{repository.nameWithOwner}</Text>
        {selected ? <GithubButton label={t('github.back')} disabled={busy} onPress={() => setSelected(null)} />
          : <GithubButton label={t('github.openRepository')} text="↗" onPress={() => openLink(repository.url)} />}
      </View>
      {!connection.isCurrent() && <Text style={s.error}>{t('status.disconnected')}</Text>}
      <GithubStatus error={details.error} onRetry={() => { void details.refetch(); }} />
      {linkError && <Text style={s.error} selectable accessibilityLiveRegion="polite">{linkError}</Text>}
    </View>
    {selected ? <GithubDetail key={key} connection={connection} repository={repository} active={active} entry={selected} section={section}
      details={details.data} busy={busy} onBusyChange={setBusy} onOpenLink={openLink}
      draft={drafts[key] ?? ''} onDraftChange={value => setDraft(key, value)}
      reviewDraft={drafts[`review:${key}`] ?? ''} onReviewDraftChange={value => setDraft(`review:${key}`, value)} />
      : <>
        <View style={s.header}>
          <View style={s.row} accessibilityRole="tablist">
            {(['issues', 'pullRequests'] as const).map(id => <GithubButton key={id} label={t(`github.${id}`)} selected={section === id}
              onPress={() => { setSection(id); list.current?.scrollToOffset({ offset: 0, animated: false }); }} />)}
            <GithubButton label={t('github.refresh')} disabled={!connected || page.isFetching} onPress={() => { void page.refetch(); void details.refetch(); }} />
          </View>
          <View style={s.row} accessibilityRole="tablist">
            {(['open', 'closed', 'all'] as const).map(id => <GithubButton key={id} label={t(`github.filter.${id}`)} selected={state === id}
              onPress={() => { setState(id); list.current?.scrollToOffset({ offset: 0, animated: false }); }} />)}
          </View>
          <View style={s.row}>
            <TextInput accessibilityLabel={t('github.search')} placeholder={t('github.search')} placeholderTextColor={palette.muted}
              style={[s.input, s.fill]} value={searchText} onChangeText={setSearchText} autoCapitalize="none" autoCorrect={false}
              returnKeyType="search" onSubmitEditing={() => setSearch(searchText.trim())} />
            <GithubButton label={t('github.applySearch')} onPress={() => { setSearch(searchText.trim()); list.current?.scrollToOffset({ offset: 0, animated: false }); }} />
          </View>
          <GithubStatus pending={page.isPending && connected} error={page.error} onRetry={() => { void retryGithubPage(page); }} />
        </View>
        <FlatList ref={list} data={page.data?.pages.flatMap(result => result.entries) ?? []} keyExtractor={entry => entry.id}
          keyboardShouldPersistTaps="handled" renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`#${item.id} ${item.title}`}
            onPress={() => setSelected(item)} style={({ pressed }) => [s.listRow, pressed && s.pressed]}>
            <Text style={s.strong}>{item.title}</Text>
            <View style={s.row}><GithubEntryState state={item.state} /></View>
            <Text style={s.muted} numberOfLines={2}>{item.subtitle}</Text>
          </Pressable>}
          ListEmptyComponent={page.isSuccess ? <View style={s.center}><Text style={s.muted}>{t(search || state !== 'open' ? 'github.noResults' : `github.empty.${section}`)}</Text></View> : undefined}
          ListFooterComponent={<View style={s.content}><GithubPagination query={page} disabled={!connected}
            onPageChange={() => list.current?.scrollToOffset({ offset: 0, animated: false })} /></View>} />
      </>}
  </KeyboardAvoidingView>;
}
