import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RuntimeGithubResource } from 'react-native-whip-ssh';
import { githubFilesQueryOptions, githubResourceQueryOptions } from '../../services/remoteGithubQueries';
import { GithubMarkdown } from './GithubMarkdown';
import { GithubPagination } from './GithubPagination';
import { retryGithubPage } from './pagination';
import { GithubButton, GithubEntryState, GithubStatus } from './parts';
import { useGithubStyles } from './styles';
import type { GithubRequest } from './types';

export function GithubResources({ connection, repository, active, id, resource, onOpenLink }: GithubRequest & {
  id: string; resource: RuntimeGithubResource; onOpenLink: (url: string) => void;
}) {
  const { s } = useGithubStyles();
  const { t } = useTranslation();
  const enabled = active && connection.isCurrent();
  const query = useInfiniteQuery({ ...githubResourceQueryOptions(connection, repository, resource, id), enabled });
  return <View style={s.stack}>
    <GithubStatus pending={query.isPending && enabled} error={query.error} onRetry={() => { void retryGithubPage(query); }} />
    {query.data?.pages.flatMap(page => page.entries).map(entry => <View key={entry.id} style={s.section}>
      <Text style={s.strong} selectable>{entry.title}</Text>
      <Text style={s.muted} selectable>{entry.subtitle}</Text>
      <GithubEntryState state={entry.state} />
      {!!entry.body && <GithubMarkdown text={entry.body} onOpenLink={onOpenLink} />}
      {!!entry.url && <GithubButton label={t('github.openOnGithub')} onPress={() => onOpenLink(entry.url)} />}
    </View>)}
    {query.isSuccess && query.data.pages.every(page => page.entries.length === 0) && <Text style={s.muted}>{t('github.noResults')}</Text>}
    <GithubPagination query={query} disabled={!enabled} />
  </View>;
}
export function GithubFiles({ connection, repository, active, id }: GithubRequest & { id: string }) {
  const { s } = useGithubStyles();
  const { t } = useTranslation();
  const enabled = active && connection.isCurrent();
  const query = useInfiniteQuery({ ...githubFilesQueryOptions(connection, repository, id, true), enabled });
  return <View style={s.stack}>
    <GithubStatus pending={query.isPending && enabled} error={query.error} onRetry={() => { void retryGithubPage(query); }} />
    {query.data?.pages.flatMap(page => page.files).map(file => <View key={file.path} style={s.section}>
      <Text style={s.strong} selectable>{file.path}</Text>
      <Text style={s.muted}>{t(`github.fileStatus.${file.status}`, { defaultValue: file.status })}  +{file.additions} −{file.deletions}</Text>
      {file.patch ? <ScrollView horizontal><Text style={s.patch} selectable>{file.patch}</Text></ScrollView>
        : <Text style={s.muted}>{t('github.patchUnavailable')}</Text>}
    </View>)}
    {query.isSuccess && query.data.pages.every(page => page.files.length === 0) && <Text style={s.muted}>{t('github.noFiles')}</Text>}
    <GithubPagination query={query} disabled={!enabled} />
  </View>;
}
