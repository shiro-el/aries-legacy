import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RuntimeGithubEntry, RuntimeGithubMutation, RuntimeGithubRepositoryDetails } from 'react-native-whip-ssh';
import { githubContentFilter, githubEntryQueryOptions, mutateGithub } from '../../services/remoteGithubQueries';
import { GithubConversation } from './GithubConversation';
import { GithubMarkdown } from './GithubMarkdown';
import { GithubMarkdownEditor } from './GithubMarkdownEditor';
import { GithubPullControls } from './GithubPullControls';
import { GithubFiles, GithubResources } from './GithubResources';
import { GithubAuthorRow, GithubButton, GithubEntryState, GithubStatus } from './parts';
import { useGithubStyles } from './styles';
import type { GithubRequest, GithubSection } from './types';

type DetailTab = 'conversation' | 'files' | 'commits' | 'checks' | 'reviews';
export function GithubDetail(props: GithubRequest & {
  entry: RuntimeGithubEntry; section: GithubSection; details?: RuntimeGithubRepositoryDetails;
  draft: string; reviewDraft: string; onDraftChange: (value: string) => void; onReviewDraftChange: (value: string) => void;
  busy: boolean; onBusyChange: (busy: boolean) => void; onOpenLink: (url: string) => void;
}) {
  const { connection, repository, active, section, onOpenLink, onBusyChange } = props;
  const { t } = useTranslation();
  const { s } = useGithubStyles();
  const cache = useQueryClient();
  const connected = active && connection.isCurrent();
  const options = githubEntryQueryOptions(connection, repository, section, props.entry.id);
  const query = useQuery({ ...options, initialData: props.entry, initialDataUpdatedAt: 0, enabled: connected });
  const entry = query.data;
  const [tab, setTab] = useState<DetailTab>('conversation');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const disabled = props.busy || !connected || query.isFetching || query.isError;
  const run = async (action: RuntimeGithubMutation, expectedHead = '') => {
    if (lock.current || disabled) return;
    lock.current = true;
    onBusyChange(true);
    setError(null); setDone(false);
    try {
      const updated = await mutateGithub(connection, repository, action, entry.id, '',
        action === 'approvePull' || action === 'requestChanges' ? props.reviewDraft : '', expectedHead);
      if (updated) cache.setQueryData(options.queryKey, updated);
      if (action === 'approvePull' || action === 'requestChanges') props.onReviewDraftChange('');
      setDone(true);
      void cache.invalidateQueries(githubContentFilter(connection, repository));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { lock.current = false; onBusyChange(false); }
  };
  return <ScrollView style={s.fill} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.stack}>
      <Text style={s.title} selectable>{entry.title}</Text>
      <Text style={s.muted} selectable>{entry.subtitle}</Text>
      <GithubEntryState state={entry.state} />
      {entry.pull && <View style={s.stack}>
        <Text style={s.muted} selectable>{entry.pull.headBranch} → {entry.pull.baseBranch}</Text>
        <View style={s.row}>
          {entry.pull.changedFiles !== undefined && <Text style={s.muted}>{t('github.changedFiles', { count: entry.pull.changedFiles })}</Text>}
          {entry.pull.additions !== undefined && <Text style={s.muted}>+{entry.pull.additions} −{entry.pull.deletions ?? 0}</Text>}
        </View>
      </View>}
      <View style={s.row}>
        <GithubButton label={t('github.refreshDetail')} disabled={!connected || props.busy || query.isFetching}
          onPress={() => { void cache.invalidateQueries(githubContentFilter(connection, repository)); }} />
        <GithubButton label={t('github.openOnGithub')} onPress={() => onOpenLink(entry.url)} />
      </View>
      <GithubStatus error={query.error} onRetry={() => { void query.refetch(); }} />
    </View>
    {section === 'pullRequests' && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
      <View style={s.row} accessibilityRole="tablist">
        {(['conversation', 'files', 'commits', 'checks', 'reviews'] as const).map(id => <GithubButton key={id} label={t(`github.${id}`)}
          selected={tab === id} disabled={props.busy} onPress={() => setTab(id)} />)}
      </View>
    </ScrollView>}
    {error && <Text style={s.error} accessibilityLiveRegion="polite" selectable>{error}</Text>}
    {done && <Text style={s.muted} accessibilityLiveRegion="polite">{t('github.actionDone')}</Text>}
    {tab === 'conversation' && <>
      <View style={s.section}>
        {entry.author && <GithubAuthorRow entry={entry} />}
        {!!entry.body && <GithubMarkdown text={entry.body} onOpenLink={onOpenLink} />}
      </View>
      {section === 'issues' ? <GithubButton label={t(entry.state === 'open' ? 'github.closeIssue' : 'github.reopenIssue')}
        disabled={disabled} onPress={() => { void run(entry.state === 'open' ? 'closeIssue' : 'reopenIssue'); }} />
        : <GithubPullControls key={`${entry.id}:${entry.state}`} entry={entry} details={props.details} disabled={disabled}
          onAction={(action, head) => { void run(action, head); }} />}
    </>}
    {/* Keep drafts and accepted comments mounted when switching detail tabs. */}
    <View style={tab === 'conversation' ? undefined : { display: 'none' }}>
      <GithubConversation {...props} active={connected && tab === 'conversation'} number={Number(entry.id)} />
    </View>
    {tab === 'files' && <GithubFiles {...props} id={entry.id} />}
    {tab === 'commits' && <GithubResources {...props} id={entry.id} resource="pullCommits" />}
    {tab === 'checks' && <GithubResources {...props} id={entry.id} resource="pullChecks" />}
    {tab === 'reviews' && <>
      <GithubResources {...props} id={entry.id} resource="pullReviews" />
      {['open', 'draft'].includes(entry.state) && <View style={s.section}>
        <Text style={s.strong}>{t('github.submitReview')}</Text>
        <GithubMarkdownEditor value={props.reviewDraft} onChange={props.onReviewDraftChange} disabled={disabled} onOpenLink={onOpenLink} />
        <View style={s.row}>
          <GithubButton label={t('github.approvePull')} disabled={disabled || entry.state === 'draft'} onPress={() => { void run('approvePull'); }} />
          <GithubButton label={t('github.requestChanges')} disabled={disabled || !props.reviewDraft.trim()} onPress={() => { void run('requestChanges'); }} />
        </View>
      </View>}
    </>}
  </ScrollView>;
}
