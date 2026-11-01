import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGithubRepository } from '../../hooks/useGithubRepository';
import type { HerdrClient } from '../../services/HerdrClient';
import { githubDiscoveryQueryOptions } from '../../services/remoteGithubQueries';
import { remoteConnectionIdentity, remoteConnectionRequest } from '../../services/remoteGitQueries';
import { GithubViewer } from './GithubViewer';
import { GithubButton, GithubStatus } from './parts';
import { useGithubStyles } from './styles';

export function GithubPane({ client, path, active, onClose }: { client: HerdrClient | null; path: string; active: boolean; onClose: () => void }) {
  const discovered = useGithubRepository(client, path, active);
  const connection = client?.activeNative ? remoteConnectionRequest(client) : null;
  // Observe the hook's cache entry for loading/error/retry, without a second discovery loop.
  const discovery = useQuery({
    ...(connection ? githubDiscoveryQueryOptions(connection, path) : { queryKey: ['remote-github', 'inactive'] }), enabled: false,
  });
  // Keep the visited viewer mounted while its discovery hook is inactive.
  const repository = discovered ?? discovery.data;
  useEffect(() => {
    if (!active || (repository && connection?.isCurrent())) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [active, repository, connection, onClose]);
  const { s } = useGithubStyles();
  const { t } = useTranslation();
  if (!connection?.isCurrent()) return <View style={s.center}><Text style={s.body}>{t('status.disconnected')}</Text></View>;
  if (!repository) return <View style={s.center}>
    <GithubStatus pending={discovery.isPending} error={discovery.error} onRetry={() => { void discovery.refetch(); }} />
    {discovery.isSuccess && <>
      <Text style={s.strong}>{t('github.repositoryUnavailable')}</Text>
      <Text style={s.muted}>{t('github.repositoryHelp')}</Text>
      <GithubButton label={t('github.retry')} disabled={discovery.isFetching} onPress={() => { void discovery.refetch(); }} />
    </>}
  </View>;
  return <GithubViewer key={`${remoteConnectionIdentity(connection).join(':')}:${repository.nameWithOwner}`} connection={connection} repository={repository} active={active} onClose={onClose} />;
}
