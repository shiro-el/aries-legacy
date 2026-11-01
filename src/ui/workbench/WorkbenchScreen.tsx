import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Pressable, Text, View } from 'react-native';
import type {
  HostRuntimeConnection,
  RuntimeGitRepository,
  RuntimeGitStatusEntry,
  RuntimeRemoteFileEntry,
} from 'react-native-whip-ssh';

import { BrowserPane } from './BrowserPane';
import { ChangesPane, DiffView } from './ChangesPane';
import { FilePreview } from './FilePreview';
import { FilesPane } from './FilesPane';
import { Notice, errorText } from './parts';
import { useWorkbenchStyles } from './styles';
import type { WorkbenchMode } from './workbench';
import { parentRemotePath } from '../../lib/remoteFiles';
import type { HerdrClient } from '../../services/HerdrClient';
import { GithubPane } from '../github/GithubPane';
import { resolveFilePath, type FileLink } from '../chat/fileLinks';

type Detail =
  | { kind: 'file'; entry: RuntimeRemoteFileEntry; line?: number }
  | { kind: 'diff'; repository: RuntimeGitRepository; entry: RuntimeGitStatusEntry }
  /** A linked path that could not be opened. */
  | { kind: 'missing'; path: string; error: string };

type Props = {
  native: HostRuntimeConnection | null;
  client?: HerdrClient | null;
  /** The pane's folder; `~` paths resolve against the remote home. */
  cwd: string;
  /** Where the back button returns to, such as the chat. */
  backLabel: string;
  initialMode?: WorkbenchMode;
  /** A file to open first, such as one an agent named in the chat. */
  initialFile?: FileLink;
  onClose: () => void;
};

const MODES: { id: WorkbenchMode; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
  { id: 'github', label: 'GitHub' },
  { id: 'browser', label: 'Browser' },
];

/** Repository tools and a browser, all seen from one pane's folder. */
export function WorkbenchScreen({ native, client = null, cwd, backLabel, initialMode = 'files', initialFile, onClose }: Props) {
  const { palette, s } = useWorkbenchStyles();
  const { t } = useTranslation();
  const [mode, setMode] = useState<WorkbenchMode>(initialMode);
  // Modes keep their state once visited, so switching back is instant.
  const [visited, setVisited] = useState<ReadonlySet<WorkbenchMode>>(() => new Set([initialMode]));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [root, setRoot] = useState<{ path: string } | { error: string } | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [changesKey, setChangesKey] = useState(0);

  useEffect(() => {
    let live = true;
    if (!native) {
      setRoot({ error: 'The host is not connected.' });
      return;
    }
    native.remoteHome().then(
      async value => {
        if (!live) return;
        const resolved = cwd === '~' || cwd.startsWith('~/') ? `${value}${cwd.slice(1)}` : cwd || value;
        setHome(value);
        if (!initialFile) {
          setRoot({ path: resolved });
          setFolder(current => current ?? resolved);
          return;
        }
        // The list behind a linked file is its folder, so going back lands beside it.
        const target = resolveFilePath(initialFile.path, resolved, value);
        // A linked folder opens as the list itself, with nothing on top.
        let opened: Detail | null = null;
        let around = resolved;
        if (!target) opened = { kind: 'missing', path: initialFile.path, error: 'The path climbs above the filesystem root.' };
        else {
          try {
            const entry = await native.statRemotePath(target);
            if (entry.kind === 'directory') around = target;
            else {
              around = parentRemotePath(target);
              opened = { kind: 'file', entry: { ...entry, path: target, name: target.slice(target.lastIndexOf('/') + 1) }, line: initialFile.line };
            }
          } catch (reason) {
            opened = { kind: 'missing', path: target, error: errorText(reason) };
          }
        }
        if (!live) return;
        setRoot({ path: resolved });
        setFolder(current => current ?? around);
        if (opened) setDetail(opened);
      },
      (reason: unknown) => { if (live) setRoot({ error: errorText(reason) }); },
    );
    return () => { live = false; };
  // The linked file is read once, when the screen opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, native]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // GitHub owns its nested list/detail back navigation once mounted.
      if (mode === 'github' && root && 'path' in root) return false;
      if (detail) setDetail(null);
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [detail, mode, root, onClose]);

  const select = (next: WorkbenchMode) => {
    setDetail(null);
    setMode(next);
    setVisited(current => (current.has(next) ? current : new Set([...current, next])));
    // Changes are re-read each time they are looked at; an agent may have edited since.
    if (next === 'changes') setChangesKey(value => value + 1);
  };

  const title = detail
    ? detail.kind === 'file' ? detail.entry.name : (detail.kind === 'diff' ? detail.entry.path : detail.path).split('/').pop() ?? ''
    : root && 'path' in root ? root.path.split('/').filter(Boolean).pop() ?? '/' : 'Project';
  const subtitle = detail
    ? detail.kind === 'file' ? detail.entry.path : detail.kind === 'diff' ? `${detail.repository.root}/${detail.entry.path}` : detail.path
    : root && 'path' in root ? root.path : undefined;

  return (
    <View style={s.screen}>
      <View style={s.bar}>
        <Pressable
          onPress={() => (detail ? setDetail(null) : onClose())}
          accessibilityRole="button"
          accessibilityLabel={detail ? 'Back to list' : `Back to ${backLabel}`}
          hitSlop={8}
        >
          <Text style={s.back}>‹ {detail ? MODES.find(item => item.id === mode)?.label : backLabel}</Text>
        </Pressable>
        <View style={s.titleWrap}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {subtitle && <Text style={s.subtitle} numberOfLines={1} ellipsizeMode="head">{subtitle}</Text>}
        </View>
      </View>
      {!detail && (
        <View style={s.modes} accessibilityRole="tablist">
          {MODES.map(item => {
            const active = item.id === mode;
            return (
              <Pressable
                key={item.id}
                onPress={() => select(item.id)}
                accessibilityRole="tab"
                accessibilityLabel={item.id === 'github' ? t('github.title') : item.label}
                accessibilityState={{ selected: active }}
                style={s.modeItem}
              >
                <Text style={[s.modeLabel, active && s.modeLabelActive]}>{item.id === 'github' ? t('github.title') : item.label}</Text>
                <View style={[s.modeMark, active && s.modeMarkActive]} />
              </Pressable>
            );
          })}
        </View>
      )}

      {!root && <Notice s={s} palette={palette} busy />}
      {root && 'error' in root && <Notice s={s} palette={palette} title="Can't reach the host" text={root.error} />}
      {root && 'path' in root && (
        <View style={s.fill}>
          {detail?.kind === 'file' && <FilePreview native={native} entry={detail.entry} line={detail.line} s={s} palette={palette} />}
          {detail?.kind === 'missing' && <Notice s={s} palette={palette} title="Can't open this file" text={detail.error} />}
          {detail?.kind === 'diff' && (
            <DiffView native={native} repository={detail.repository} entry={detail.entry} s={s} palette={palette} />
          )}
          {visited.has('files') && folder && (
            <View style={!detail && mode === 'files' ? s.fill : { display: 'none' }}>
              <FilesPane
                native={native}
                path={folder}
                home={home}
                s={s}
                palette={palette}
                onNavigate={setFolder}
                onOpenFile={entry => setDetail({ kind: 'file', entry })}
              />
            </View>
          )}
          {visited.has('changes') && (
            <View style={!detail && mode === 'changes' ? s.fill : { display: 'none' }}>
              <ChangesPane
                native={native}
                cwd={root.path}
                s={s}
                palette={palette}
                refreshKey={changesKey}
                onOpenDiff={(repository, entry) => setDetail({ kind: 'diff', repository, entry })}
              />
            </View>
          )}
          {visited.has('github') && (
            <View style={!detail && mode === 'github' ? s.fill : { display: 'none' }}>
              <GithubPane client={client} path={root.path} active={!detail && mode === 'github'} onClose={onClose} />
            </View>
          )}
          {visited.has('browser') && (
            <View style={!detail && mode === 'browser' ? s.fill : { display: 'none' }}>
              <BrowserPane native={native} s={s} palette={palette} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
