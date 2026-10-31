import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { HostRuntimeConnection, RuntimeRemoteFileEntry } from 'react-native-whip-ssh';

import { formatRemoteFileSize, parentRemotePath, sortRemoteEntries } from '../../lib/remoteFiles';
import { Crumbs, Notice, errorText } from './parts';
import { useWorkbenchStyles, type WorkbenchStyles } from './styles';
import { FileGlyph } from './FileGlyph';
import { crumbs } from './workbench';
import type { Palette } from '../theme/tokens';

type Listing =
  | { state: 'loading'; path: string }
  | { state: 'ready'; path: string; entries: RuntimeRemoteFileEntry[] }
  | { state: 'failed'; path: string; error: string };

type Props = {
  native: HostRuntimeConnection | null;
  /** Absolute folder to show; the parent owns it so it survives mode switches. */
  path: string;
  home: string | null;
  s: WorkbenchStyles;
  palette: Palette;
  onNavigate: (path: string) => void;
  onOpenFile: (entry: RuntimeRemoteFileEntry) => void;
};

/** One remote folder at a time: folders first, then files, newest listing on pull. */
export function FilesPane({ native, path, home, s, palette, onNavigate, onOpenFile }: Props) {
  const [listing, setListing] = useState<Listing>(() => {
    const cached = native?.cachedDirectory(path);
    return cached ? { state: 'ready', path, entries: cached.entries } : { state: 'loading', path };
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (target: string) => {
    if (!native) {
      setListing({ state: 'failed', path: target, error: 'The host is not connected.' });
      return;
    }
    try {
      const result = await native.listDirectory(target);
      setListing(current => (current.path === target ? { state: 'ready', path: target, entries: result.entries } : current));
    } catch (reason) {
      setListing(current => (current.path === target ? { state: 'failed', path: target, error: errorText(reason) } : current));
    }
  }, [native]);

  useEffect(() => {
    const cached = native?.cachedDirectory(path);
    setListing(cached ? { state: 'ready', path, entries: cached.entries } : { state: 'loading', path });
    // A cached listing shows at once and is refreshed underneath.
    void load(path);
  }, [load, native, path]);

  const refresh = async () => {
    setRefreshing(true);
    await load(path);
    setRefreshing(false);
  };

  // A symlink is followed only when tapped, so a listing never waits on it.
  const open = async (entry: RuntimeRemoteFileEntry) => {
    if (isFolder(entry)) return onNavigate(entry.path);
    if (entry.kind !== 'symlink' || !native) return onOpenFile(entry);
    try {
      const target = await native.statRemotePath(entry.path);
      if (target.kind === 'directory') onNavigate(entry.path);
      else onOpenFile({ ...target, name: entry.name, path: entry.path });
    } catch (reason) {
      setListing({ state: 'failed', path, error: errorText(reason) });
    }
  };

  const entries = useMemo(() => {
    if (listing.state !== 'ready') return [];
    const sorted = sortRemoteEntries(listing.entries, 'name', 'ascending');
    return [...sorted.filter(isFolder), ...sorted.filter(entry => !isFolder(entry))];
  }, [listing]);

  return (
    <View style={s.fill}>
      <View style={s.toolbar}>
        <Crumbs s={s} items={crumbs(path, home)} onSelect={onNavigate} />
      </View>
      {listing.state === 'loading' && <Notice s={s} palette={palette} busy />}
      {listing.state === 'failed' && (
        <Notice s={s} palette={palette} title="Can't open this folder" text={listing.error} action={{ label: 'Try again', onPress: () => { void refresh(); } }} />
      )}
      {listing.state === 'ready' && (
        <FlatList
          data={entries}
          keyExtractor={entry => entry.path}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} />}
          ListHeaderComponent={path === '/' ? undefined : (
            <>
              <Pressable
                onPress={() => onNavigate(parentRemotePath(path))}
                accessibilityRole="button"
                accessibilityLabel="Parent folder"
                style={({ pressed }) => [s.row, pressed && s.pressed]}
              >
                <FileGlyph parent />
                <Text style={[s.rowName, s.rowFolder]}>../</Text>
              </Pressable>
              {entries.length > 0 && <Separator />}
            </>
          )}
          ListEmptyComponent={<Notice s={s} palette={palette} text="This folder is empty." />}
          contentContainerStyle={entries.length === 0 ? s.fill : undefined}
          renderItem={({ item }) => {
            const folder = isFolder(item);
            return (
              <Pressable
                onPress={() => { void open(item); }}
                accessibilityRole="button"
                accessibilityLabel={folder ? `Folder ${item.name}` : `File ${item.name}`}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
              >
                <FileGlyph entry={item} />
                <Text style={[s.rowName, folder && s.rowFolder]} numberOfLines={1}>
                  {folder ? `${item.name}/` : item.name}
                </Text>
                {!folder && item.size !== undefined && <Text style={s.rowMeta}>{formatRemoteFileSize(item.size)}</Text>}
                {item.kind === 'symlink' && <Text style={s.rowMeta}>link</Text>}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function isFolder(entry: RuntimeRemoteFileEntry): boolean {
  return entry.kind === 'directory';
}

function Separator() {
  const { s } = useWorkbenchStyles();
  return <View style={s.sep} />;
}
