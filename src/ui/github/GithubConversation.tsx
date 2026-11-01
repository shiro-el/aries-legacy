import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RuntimeGithubEntry } from 'react-native-whip-ssh';
import { githubCommentsQueryOptions, githubContentFilter, postGithubComment } from '../../services/remoteGithubQueries';
import { GithubMarkdown } from './GithubMarkdown';
import { GithubMarkdownEditor } from './GithubMarkdownEditor';
import { GithubPagination } from './GithubPagination';
import { retryGithubPage } from './pagination';
import { GithubAuthorRow, GithubButton, GithubStatus } from './parts';
import { useGithubStyles } from './styles';
import type { GithubRequest } from './types';

export function GithubConversation({ connection, repository, active, number, draft, onDraftChange, busy, onBusyChange, onOpenLink }: GithubRequest & {
  number: number; draft: string; onDraftChange: (draft: string) => void;
  busy: boolean; onBusyChange: (busy: boolean) => void; onOpenLink: (url: string) => void;
}) {
  const { t } = useTranslation();
  const { s } = useGithubStyles();
  const client = useQueryClient();
  const connected = active && connection.isCurrent();
  const comments = useInfiniteQuery({ ...githubCommentsQueryOptions(connection, repository, number), enabled: connected });
  const [posted, setPosted] = useState<RuntimeGithubEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const loaded = [...new Map(comments.data?.pages.flatMap(page => page.entries).map(entry => [entry.id, entry]) ?? []).values()];
  const loadedIds = new Set(loaded.map(entry => entry.id));
  const submit = async () => {
    if (lock.current || busy || !connected || !draft.trim()) return;
    lock.current = true;
    onBusyChange(true);
    setError(null);
    try {
      const comment = await postGithubComment(connection, repository, number, draft);
      setPosted(current => [...current, comment]);
      onDraftChange('');
      void client.invalidateQueries(githubContentFilter(connection, repository));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { lock.current = false; onBusyChange(false); }
  };
  const render = (entry: RuntimeGithubEntry) => <View key={entry.id} style={s.section}>
    <GithubAuthorRow entry={entry} />
    <GithubMarkdown text={entry.body} onOpenLink={onOpenLink} />
  </View>;
  return <View style={s.section}>
    <View style={s.between}>
      <Text style={s.strong}>{t('github.conversation')}</Text>
      <GithubButton label={t('github.refreshConversation')} disabled={!connected || busy || comments.isFetching} onPress={() => { void comments.refetch(); }} />
    </View>
    <GithubStatus pending={comments.isPending && connected} error={comments.error} onRetry={() => { void retryGithubPage(comments); }} />
    {loaded.map(render)}
    <GithubPagination query={comments} disabled={!connected || busy} />
    {posted.filter(entry => !loadedIds.has(entry.id)).map(render)}
    {posted.length > 0 && <Text style={s.muted} accessibilityLiveRegion="polite">{t('github.commentPosted')}</Text>}
    <GithubMarkdownEditor value={draft} onChange={onDraftChange} disabled={!connected || busy} onOpenLink={onOpenLink} />
    {error && <Text style={s.error} accessibilityLiveRegion="polite" selectable>{error}</Text>}
    <GithubButton label={t(busy ? 'github.posting' : 'github.postComment')} disabled={!connected || busy || !draft.trim()} onPress={() => { void submit(); }} />
  </View>;
}
