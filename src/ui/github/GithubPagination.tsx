import { useRef } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GithubButton } from './parts';
import { githubCurrentPage, type GithubPageQuery } from './pagination';
import { useGithubStyles } from './styles';

export function GithubPagination({ query, disabled = false, onPageChange }: {
  query: GithubPageQuery; disabled?: boolean; onPageChange?: () => void;
}) {
  const { t } = useTranslation();
  const { s } = useGithubStyles();
  const lock = useRef(false);
  if (!query.data || (!query.hasNextPage && !query.hasPreviousPage)) return null;
  const navigate = async (fetch: () => Promise<unknown>) => {
    if (lock.current || disabled || query.isFetching) return;
    lock.current = true;
    try { await fetch(); onPageChange?.(); }
    finally { lock.current = false; }
  };
  return <View style={s.between}>
    <GithubButton label={t('github.previousPage')} disabled={disabled || query.isFetching || !query.hasPreviousPage}
      onPress={() => { void navigate(query.fetchPreviousPage); }} />
    <Text style={s.muted} accessibilityLiveRegion="polite">{t('github.page', { number: githubCurrentPage(query.data) })}</Text>
    <GithubButton label={t('github.nextPage')} disabled={disabled || query.isFetching || !query.hasNextPage}
      onPress={() => { void navigate(query.fetchNextPage); }} />
  </View>;
}
