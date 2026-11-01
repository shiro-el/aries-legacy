export interface GithubPageQuery {
  data?: { pageParams: unknown[] };
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isFetching: boolean;
  fetchNextPage: () => Promise<unknown>;
  fetchPreviousPage: () => Promise<unknown>;
}

/** The query service retains just one page, including when navigating backwards. */
export function githubCurrentPage(data?: GithubPageQuery['data']) {
  const page = data?.pageParams[0];
  return typeof page === 'number' ? page : 1;
}
export function retryGithubPage(query: Pick<GithubPageQuery, 'fetchNextPage' | 'fetchPreviousPage'> & {
  isFetchNextPageError: boolean; isFetchPreviousPageError: boolean; refetch: () => Promise<unknown>;
}) {
  if (query.isFetchNextPageError) return query.fetchNextPage();
  if (query.isFetchPreviousPageError) return query.fetchPreviousPage();
  return query.refetch();
}
