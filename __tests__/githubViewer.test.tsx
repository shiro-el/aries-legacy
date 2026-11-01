import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackHandler, Text, TextInput } from 'react-native';
import { formatGithubComment, type RuntimeGithubEntry } from 'react-native-whip-ssh';
import { WorkbenchScreen } from '../src/ui/workbench/WorkbenchScreen';
import { GithubPane } from '../src/ui/github/GithubPane';
import { GithubViewer } from '../src/ui/github/GithubViewer';
import { GithubMarkdownEditor } from '../src/ui/github/GithubMarkdownEditor';
import { GithubPullControls } from '../src/ui/github/GithubPullControls';
import { GithubPagination } from '../src/ui/github/GithubPagination';
import { githubCurrentPage, retryGithubPage } from '../src/ui/github/pagination';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
import type { HerdrClient } from '../src/services/HerdrClient';
import type { RemoteGitConnection } from '../src/services/remoteGitQueries';

jest.mock('../src/ui/workbench/FilesPane', () => ({ FilesPane: () => null }));
jest.mock('../src/ui/workbench/ChangesPane', () => ({ ChangesPane: () => null, DiffView: () => null }));
jest.mock('../src/ui/workbench/FilePreview', () => ({ FilePreview: () => null }));
jest.mock('../src/ui/workbench/BrowserPane', () => ({ BrowserPane: () => null }));
jest.mock('react-native-whip-ssh', () => ({ formatGithubComment: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn().mockResolvedValue({}) }));
jest.mock('react-native-enriched-markdown', () => ({
  EnrichedMarkdownText: ({ markdown }: { markdown: string }) => {
    const React = require('react');
    return React.createElement(require('react-native').Text, null, markdown);
  },
}));
jest.mock('react-i18next', () => {
  const i18n = require('i18next').createInstance();
  void i18n.init({ lng: 'en', resources: { en: { translation: require('../src/locales/en').en } }, keySeparator: false, initAsync: false });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n) }) };
});

const repo = { directory: '/repo', nameWithOwner: 'owner/repo', url: 'https://github.com/owner/repo' };
const issue: RuntimeGithubEntry = { id: '12', title: 'Fix reconnect', subtitle: 'opened by sam', state: 'open', body: '**Description**', url: `${repo.url}/issues/12`, author: { login: 'sam', avatarUrl: '' } };
const pull: RuntimeGithubEntry = { ...issue, id: '13', title: 'Reconnect fix', url: `${repo.url}/pull/13`, pull: { headSha: 'abcdef123456', headBranch: 'fix/reconnect', baseBranch: 'main', mergeable: true } };
const comment: RuntimeGithubEntry = { ...issue, id: '100', title: 'sam', body: 'Posted reply' };
const native = {
  remoteHome: jest.fn().mockResolvedValue('/home/sam'),
  runtimeId: 'github-ui-test', status: jest.fn(() => ({ state: 'connected', generation: 1n })),
  discoverGithubRepository: jest.fn(), githubRepositoryDetails: jest.fn(), githubPage: jest.fn(),
  githubEntry: jest.fn(), githubComments: jest.fn(), githubPostComment: jest.fn(), githubMutate: jest.fn(),
  githubFiles: jest.fn(), githubResource: jest.fn(),
};
const client = { native, activeNative: native } as unknown as HerdrClient;
const connection: RemoteGitConnection = { native: native as unknown as RemoteGitConnection['native'], generation: 1n, isCurrent: () => native.status().state === 'connected' };
let root: ReactTestRenderer;
const onClose = jest.fn();
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); };
const button = (label: string) => root.root.findAll(node => node.type !== Text && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); await flush(); };
const texts = () => root.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
const render = async (node = <GithubViewer connection={connection} repository={repo} active onClose={onClose} />) => {
  await act(async () => { root = create(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>); });
  await flush();
};
const update = async (node: React.ReactNode) => {
  await act(async () => { root.update(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>); });
  await flush();
};
const type = async (label: string, value: string) => {
  await act(async () => { root.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!.props.onChangeText(value); });
};

beforeEach(() => {
  jest.clearAllMocks();
  native.status.mockReturnValue({ state: 'connected', generation: 1n });
  native.discoverGithubRepository.mockResolvedValue(repo);
  native.githubRepositoryDetails.mockResolvedValue({ stars: 3, allowMergeCommit: false, allowSquashMerge: true, allowRebaseMerge: false });
  native.githubPage.mockImplementation((_repo, section, page) => Promise.resolve({ entries: [section === 'issues' ? { ...issue, id: page === 2 ? '22' : '12' } : pull], hasMore: page === 1 }));
  native.githubEntry.mockImplementation((_repo, section) => Promise.resolve(section === 'issues' ? issue : pull));
  native.githubComments.mockResolvedValue({ entries: [], hasMore: false });
  native.githubPostComment.mockResolvedValue(comment);
  native.githubMutate.mockResolvedValue(undefined);
  native.githubFiles.mockResolvedValue({ files: [], hasMore: false });
  native.githubResource.mockResolvedValue({ entries: [], hasMore: false });
});
afterEach(() => { act(() => root?.unmount()); queryClient.clear(); });

test('discovers the pane folder and keeps selection and drafts across workbench tabs', async () => {
  await render(<GithubPane client={client} path="/repo/subfolder" active onClose={onClose} />);
  expect(native.discoverGithubRepository).toHaveBeenCalledWith('/repo/subfolder');
  await press('#12 Fix reconnect');
  await type('Write a reply…', 'Unsent reply');
  await update(<GithubPane client={client} path="/repo/subfolder" active={false} onClose={onClose} />);
  await update(<GithubPane client={client} path="/repo/subfolder" active onClose={onClose} />);
  expect(root.root.findByType(TextInput).props.value).toBe('Unsent reply');
  expect(button('Back to list')).toBeDefined();
});

test('shows discovery failures and retries, and explains unavailable repositories', async () => {
  native.discoverGithubRepository.mockRejectedValueOnce(new Error('Host read failed')).mockResolvedValueOnce(null);
  await render(<GithubPane client={client} path="/repo" active onClose={onClose} />);
  expect(texts().some(text => text.includes('Host read failed'))).toBe(true);
  await press('Retry');
  expect(texts()).toContain('GitHub repository unavailable');
  expect(texts().some(text => text.includes('gh auth login'))).toBe(true);
});

test('paginates both directions, retries the failed destination, and applies filters and search', async () => {
  await render();
  native.githubPage.mockRejectedValueOnce(new Error('Next page failed'));
  await press('Next page');
  expect(texts().some(text => text.includes('Next page failed'))).toBe(true);
  await press('Retry');
  expect(native.githubPage).toHaveBeenLastCalledWith(repo, 'issues', 2, 'open', '');
  expect(texts()).toContain('Page 2');
  await press('Previous page');
  expect(native.githubPage).toHaveBeenLastCalledWith(repo, 'issues', 1, 'open', '');
  await press('Closed');
  await type('Search issues or PRs', 'author:sam');
  await press('Search');
  expect(native.githubPage).toHaveBeenLastCalledWith(repo, 'issues', 1, 'closed', 'author:sam');
  await press('PRs');
  expect(native.githubPage).toHaveBeenLastCalledWith(repo, 'pullRequests', 1, 'closed', 'author:sam');
});

test('retains rejected comment drafts and prevents duplicate posts while sending', async () => {
  await render(); await press('#12 Fix reconnect');
  await type('Write a reply…', 'Unsent reply');
  native.githubPostComment.mockRejectedValueOnce(new Error('Login required'));
  await press('Comment');
  expect(root.root.findByType(TextInput).props.value).toBe('Unsent reply');
  expect(texts()).toContain('Login required');
  let accept!: (entry: RuntimeGithubEntry) => void;
  native.githubPostComment.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const submit = button('Comment').props.onPress;
  await act(async () => { submit(); submit(); });
  expect(native.githubPostComment).toHaveBeenCalledTimes(2);
  await act(async () => { accept(comment); }); await flush();
  expect(root.root.findByType(TextInput).props.value).toBe('');
  expect(texts()).toContain('Posted reply');
  expect(texts()).toContain('Comment posted.');
  await press('Back to list'); await press('#12 Fix reconnect');
  expect(root.root.findByType(TextInput).props.value).toBe('');
});

test('conversation pages both directions without losing the reply draft', async () => {
  native.githubComments.mockImplementation((_repo, _number, page) => Promise.resolve({ entries: [{ ...comment, id: String(page), body: `Comment page ${String(page)}` }], hasMore: page === 1 }));
  await render(); await press('#12 Fix reconnect');
  await type('Write a reply…', 'Keep this');
  await press('Next page');
  expect(texts()).toContain('Comment page 2');
  expect(texts()).not.toContain('Comment page 1');
  await press('Previous page');
  expect(native.githubComments).toHaveBeenLastCalledWith(repo, 12, 1);
  expect(root.root.findByType(TextInput).props.value).toBe('Keep this');
});

test('respects merge methods and sends the explicitly confirmed head SHA', async () => {
  await render(); await press('PRs'); await press('#13 Reconnect fix');
  expect(button('Merge pull request').props.disabled).toBe(true);
  expect(button('Rebase and merge').props.disabled).toBe(true);
  await press('Review merge');
  expect(native.githubMutate).not.toHaveBeenCalled();
  expect(texts()).toContain('Head commit abcdef1');
  await press('Confirm merge');
  expect(native.githubMutate).toHaveBeenCalledWith(repo, 'squashPull', '13', '', '', 'abcdef123456');
});

test('disables a merge confirmation if the PR head changes', async () => {
  const onAction = jest.fn();
  await render(<GithubPullControls entry={pull} disabled={false} onAction={onAction} />);
  await press('Review merge');
  await update(<GithubPullControls entry={{ ...pull, pull: { ...pull.pull!, headSha: 'new-head' } }} disabled={false} onAction={onAction} />);
  expect(button('Confirm merge').props.disabled).toBe(true);
});

test.each(['draft', 'closed', 'merged'])('does not allow merging a %s pull request', async state => {
  await render(<GithubPullControls entry={{ ...pull, state }} disabled={false} onAction={jest.fn()} />);
  if (state === 'draft') expect(button('Review merge').props.disabled).toBe(true);
  else expect(button('Review merge')).toBeUndefined();
});

test('loads PR resources and submits review text through the existing mutation service', async () => {
  await render(); await press('PRs'); await press('#13 Reconnect fix');
  await type('Write a reply…', 'Keep conversation draft');
  await press('Files changed');
  expect(native.githubFiles).toHaveBeenCalledWith(repo, '13', true, 1);
  await press('Checks');
  expect(native.githubResource).toHaveBeenCalledWith(repo, 'pullChecks', '13', 1);
  await press('Reviews');
  const editors = root.root.findAllByType(TextInput);
  await act(async () => { editors[editors.length - 1].props.onChangeText('Needs a regression test'); });
  await press('Request changes');
  expect(native.githubMutate).toHaveBeenCalledWith(repo, 'requestChanges', '13', '', 'Needs a regression test', '');
  await press('Conversation');
  expect(root.root.findByType(TextInput).props.value).toBe('Keep conversation draft');
});

test('routes Android back to the list before closing the workbench', async () => {
  let back: (() => boolean | null | undefined) | undefined;
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    back = () => callback({} as Parameters<typeof callback>[0]); return { remove: jest.fn() };
  });
  try {
    await render(); await press('#12 Fix reconnect');
    await act(async () => { expect(back?.()).toBe(true); }); await flush();
    expect(button('#12 Fix reconnect')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { back?.(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally { listener.mockRestore(); }
});

test('uses native markdown formatting with the selected range and offers a rendered preview', async () => {
  const change = jest.fn();
  jest.mocked(formatGithubComment).mockReturnValue({ text: '**reply**', selection: { start: 2, end: 7 } });
  await render(<GithubMarkdownEditor value="reply" onChange={change} disabled={false} onOpenLink={jest.fn()} />);
  await act(async () => { root.root.findByType(TextInput).props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 5 } } }); });
  await press('Bold');
  expect(formatGithubComment).toHaveBeenCalledWith('reply', { start: 0, end: 5 }, 'bold');
  expect(change).toHaveBeenCalledWith('**reply**');
  await press('Preview');
  expect(root.root.findAllByType(TextInput)).toHaveLength(0);
  expect(texts()).toContain('reply');
});

test('pagination locks rapid navigation until the current request finishes', async () => {
  let finish!: () => void;
  const next = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(<GithubPagination query={{ data: { pageParams: [1] }, hasNextPage: true, hasPreviousPage: false,
    isFetching: false, fetchNextPage: next, fetchPreviousPage: jest.fn() }} />);
  await act(async () => { const click = button('Next page').props.onPress; click(); click(); });
  expect(next).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});

test('page helpers handle an empty cache and retry the failed direction', async () => {
  expect(githubCurrentPage()).toBe(1);
  expect(githubCurrentPage({ pageParams: [3] })).toBe(3);
  const query = { isFetchNextPageError: false, isFetchPreviousPageError: true,
    fetchNextPage: jest.fn(), fetchPreviousPage: jest.fn(), refetch: jest.fn() };
  await retryGithubPage(query);
  expect(query.fetchPreviousPage).toHaveBeenCalledTimes(1);
  query.isFetchPreviousPageError = false;
  await retryGithubPage(query);
  expect(query.refetch).toHaveBeenCalledTimes(1);
});


test('opens GitHub beside Changes using the resolved host folder and handles nested Android back', async () => {
  const handlers: Array<Parameters<typeof BackHandler.addEventListener>[1]> = [];
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    handlers.push(callback);
    return { remove: () => { const index = handlers.indexOf(callback); if (index >= 0) handlers.splice(index, 1); } };
  });
  const back = () => {
    for (const handler of [...handlers].reverse()) if (handler({} as Parameters<typeof handler>[0])) return true;
    return false;
  };
  try {
    await render(<WorkbenchScreen native={connection.native} client={client} cwd="~/repo" backLabel="Chat" onClose={onClose} />);
    expect(native.discoverGithubRepository).not.toHaveBeenCalled();
    await press('GitHub');
    expect(native.discoverGithubRepository).toHaveBeenCalledWith('/home/sam/repo');
    await press('#12 Fix reconnect');
    await act(async () => { expect(back()).toBe(true); }); await flush();
    expect(button('#12 Fix reconnect')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { expect(back()).toBe(true); });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally { listener.mockRestore(); }
});
