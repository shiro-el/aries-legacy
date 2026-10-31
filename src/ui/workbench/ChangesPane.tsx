import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type {
  HostRuntimeConnection,
  RuntimeGitDiff,
  RuntimeGitDiffContext,
  RuntimeGitRepository,
  RuntimeGitStatusEntry,
} from 'react-native-whip-ssh';

import { remoteGitStatusLabel } from '../../lib/remoteGit';
import type { Palette } from '../theme/tokens';
import { Chip, CodeFrame, Notice, Segments, errorText } from './parts';
import { useWorkbenchStyles, type WorkbenchStyles } from './styles';
import { codeSegments, type CodeSegment } from './syntax';
import { codeColumns, codeText } from './workbench';

type Status =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'ready'; repository: RuntimeGitRepository; entries: RuntimeGitStatusEntry[] }
  | { state: 'failed'; error: string };

type DiffRow = RuntimeGitDiff['rows'][number] & { segments: CodeSegment[] };

type Props = {
  native: HostRuntimeConnection | null;
  /** Folder the pane works in; its repository is found from here. */
  cwd: string;
  s: WorkbenchStyles;
  palette: Palette;
  /** Bumped by the parent when the screen comes back into view. */
  refreshKey: number;
  onOpenDiff: (repository: RuntimeGitRepository, entry: RuntimeGitStatusEntry) => void;
};

/** Uncommitted changes in the pane's repository. */
export function ChangesPane({ native, cwd, s, palette, refreshKey, onOpenDiff }: Props) {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!native) {
      setStatus({ state: 'failed', error: 'The host is not connected.' });
      return;
    }
    try {
      const repository = await native.discoverGitRepository(cwd);
      if (!repository) {
        setStatus({ state: 'none' });
        return;
      }
      const entries = await native.gitStatus(repository.root);
      setStatus({ state: 'ready', repository, entries });
    } catch (reason) {
      setStatus({ state: 'failed', error: errorText(reason) });
    }
  }, [cwd, native]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (status.state === 'loading') return <Notice s={s} palette={palette} busy />;
  if (status.state === 'none') {
    return <Notice s={s} palette={palette} title="Not a git repository" text={`${cwd} is not inside a git repository.`} />;
  }
  if (status.state === 'failed') {
    return <Notice s={s} palette={palette} title="Can't read changes" text={status.error} action={{ label: 'Try again', onPress: () => { void refresh(); } }} />;
  }

  const { repository, entries } = status;
  return (
    <FlatList
      data={entries}
      keyExtractor={entry => `${entry.indexStatus}${entry.worktreeStatus}:${entry.path}`}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} />}
      ListHeaderComponent={
        <Text style={s.note} numberOfLines={1}>
          {entries.length === 0 ? repository.root : `${entries.length} changed in ${repository.root}`}
        </Text>
      }
      ListEmptyComponent={<Notice s={s} palette={palette} title="No changes" text="The working tree matches the last commit." />}
      contentContainerStyle={entries.length === 0 ? s.fill : undefined}
      renderItem={({ item }) => {
        const slash = item.path.lastIndexOf('/');
        return (
          <Pressable
            onPress={() => onOpenDiff(repository, item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.path}, ${remoteGitStatusLabel(item)}`}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <Text style={s.rowCode}>{remoteGitStatusLabel(item)}</Text>
            <View style={s.fill}>
              <Text style={s.rowName} numberOfLines={1}>{item.path.slice(slash + 1)}</Text>
              {slash > 0 && <Text style={s.rowDir} numberOfLines={1}>{item.path.slice(0, slash)}</Text>}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

/** One file's diff. Starts compact and can grow to the whole file. */
export function DiffView({ native, repository, entry, s, palette }: {
  native: HostRuntimeConnection | null;
  repository: RuntimeGitRepository;
  entry: RuntimeGitStatusEntry;
  s: WorkbenchStyles;
  palette: Palette;
}) {
  const [context, setContext] = useState<RuntimeGitDiffContext>('compact');
  const [diff, setDiff] = useState<{ value: RuntimeGitDiff } | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [wrap, setWrap] = useState(true);
  const rows = useMemo<DiffRow[]>(() => {
    if (!diff || !('value' in diff) || diff.value.kind !== 'text') return [];
    const value = diff.value;
    const syntax = new Map((value.syntax?.[palette.scheme] ?? []).map(line => [line.key, line.spans]));
    const changed = new Map((value.highlights ?? []).map(mark => [mark.row, mark.spans]));
    return value.rows.flatMap((row, index) => (row.kind === 'header' || row.kind === 'meta'
      ? []
      : [{ ...row, segments: row.kind === 'hunk' ? [] : codeSegments(row.content, syntax.get(row.key), changed.get(index)) }]));
  }, [diff, palette.scheme]);
  const columns = useMemo(() => (wrap ? 0 : rows.reduce((most, row) => Math.max(most, codeColumns(row.content)), 0)), [rows, wrap]);

  useEffect(() => {
    let live = true;
    setDiff(null);
    if (!native) {
      setDiff({ error: 'The host is not connected.' });
      return;
    }
    native.gitDiff(repository, entry, context).then(
      value => { if (live) setDiff({ value }); },
      (reason: unknown) => { if (live) setDiff({ error: errorText(reason) }); },
    );
    return () => { live = false; };
  }, [attempt, context, entry, native, repository]);

  const toolbar = (
    <View style={s.toolbar}>
      {diff && 'value' in diff && diff.value.kind === 'text'
        ? (
          <Text style={s.diffStat}>
            <Text style={s.diffMarkerAdded}>+{diff.value.additions}</Text>{' '}
            <Text style={s.diffMarkerRemoved}>−{diff.value.deletions}</Text>
          </Text>
        )
        : <Text style={s.diffHead}>{remoteGitStatusLabel(entry)}</Text>}
      <View style={s.spacer} />
      <Chip s={s} label="Wrap" on={wrap} onPress={() => setWrap(value => !value)} />
      <Chip s={s} label="Whole file" on={context === 'full'} onPress={() => setContext(value => (value === 'full' ? 'compact' : 'full'))} />
    </View>
  );

  let body;
  if (!diff) body = <Notice s={s} palette={palette} busy />;
  else if ('error' in diff) {
    body = <Notice s={s} palette={palette} title="Can't load this diff" text={diff.error} action={{ label: 'Try again', onPress: () => setAttempt(value => value + 1) }} />;
  } else if (diff.value.kind === 'binary') body = <Notice s={s} palette={palette} title="Binary file" text="This file changed, but it is not text." />;
  else if (diff.value.kind === 'empty') body = <Notice s={s} palette={palette} title="No line changes" text="Only the file mode or name changed." />;
  else {
    body = (
      <CodeFrame wrap={wrap} columns={columns} gutter={DIFF_GUTTER}>
        <FlatList
          data={rows}
          keyExtractor={row => row.key}
          contentContainerStyle={s.code}
          initialNumToRender={60}
          ListFooterComponent={diff.value.truncated ? <Text style={s.note}>The diff is too long to show in full.</Text> : undefined}
          renderItem={({ item }) => {
            if (item.kind === 'hunk') return <Text style={s.diffHunk}>{codeText(item.content)}</Text>;
            const added = item.kind === 'addition';
            const removed = item.kind === 'deletion';
            return (
              <View style={[s.diffRow, added && s.diffAdded, removed && s.diffRemoved]}>
                <Text style={s.diffNo}>{item.oldLine ?? ''}</Text>
                <Text style={s.diffNo}>{item.newLine ?? ''}</Text>
                <Text style={[s.diffMarker, added && s.diffMarkerAdded, removed && s.diffMarkerRemoved]}>{added ? '+' : removed ? '−' : ''}</Text>
                <Text style={s.diffText} selectable>
                  <Segments s={s} segments={item.segments} side={added ? 'added' : removed ? 'removed' : undefined} />
                </Text>
              </View>
            );
          }}
        />
      </CodeFrame>
    );
  }

  return (
    <View style={s.fill}>
      {toolbar}
      {body}
    </View>
  );
}

/** Two line number columns, the marker and the row's right padding, matching the diff styles. */
const DIFF_GUTTER = 40 + 40 + 18 + 16;

function Separator() {
  const { s } = useWorkbenchStyles();
  return <View style={s.sep} />;
}
