import { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import type { RuntimeRemoteFileEntry } from 'react-native-whip-ssh';

import { useFolderTints, usePalette } from '../theme/tokens';
import { PARENT_FOLDER_LOOK, folderLook, folderXml, zedFileIcon, type FolderLook } from './fileIcons';
import { ZED_ICON_XML } from './zedIcons.generated';

const SIZE = 20;

type Props =
  /** The `../` row that leads to the parent folder. */
  | { parent: true }
  | { entry: Pick<RuntimeRemoteFileEntry, 'name' | 'kind'> };

/**
 * The icon at the start of a file list row, from Zed's icon set. Folders are
 * tinted by what they usually hold, with a badge cut out of the folder body.
 * Every other entry, links included, gets the muted icon Zed gives its name,
 * as Zed's project panel does.
 */
export function FileGlyph(props: Props) {
  if ('parent' in props) return <Folder look={PARENT_FOLDER_LOOK} />;
  if (props.entry.kind === 'directory') return <Folder look={folderLook(props.entry.name)} />;
  return <File name={props.entry.name} />;
}

function File({ name }: { name: string }) {
  const palette = usePalette();
  return <SvgXml xml={ZED_ICON_XML[zedFileIcon(name)]} width={SIZE} height={SIZE} color={palette.muted} />;
}

function Folder({ look }: { look: FolderLook }) {
  const palette = usePalette();
  const tints = useFolderTints();
  const xml = useMemo(() => folderXml(look.badge, palette.bg), [look.badge, palette.bg]);
  return <SvgXml xml={xml} width={SIZE} height={SIZE} color={tints[look.tint]} />;
}
