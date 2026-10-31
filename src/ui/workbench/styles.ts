import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { fonts, radius, space, type, usePalette, type Palette } from '../theme/tokens';

export function useWorkbenchStyles() {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  return { palette, s };
}

export type WorkbenchStyles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  const mono = { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    fill: { flex: 1 },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.sm,
    },
    back: { ...type.bodyMedium, color: p.muted },
    titleWrap: { flex: 1, minWidth: 0 },
    title: { ...type.bodyBold, color: p.text },
    subtitle: { ...type.caption, color: p.muted, marginTop: 1 },
    modes: {
      flexDirection: 'row',
      gap: space.xl,
      paddingHorizontal: space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    modeItem: { paddingTop: space.sm, gap: space.sm, alignItems: 'flex-start' },
    modeLabel: { ...type.bodyMedium, color: p.muted },
    modeLabelActive: { color: p.text, fontFamily: fonts.bold },
    modeMark: { alignSelf: 'stretch', height: 2, borderRadius: 1, backgroundColor: 'transparent' },
    modeMarkActive: { backgroundColor: p.text },

    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    crumbs: { flexGrow: 0, flexShrink: 1 },
    crumbsContent: { alignItems: 'center' },
    crumb: { ...type.caption, fontFamily: fonts.medium, color: p.muted, paddingVertical: space.xs },
    crumbLast: { color: p.text },
    crumbSep: { ...type.caption, color: p.seam, paddingHorizontal: 2 },
    spacer: { flex: 1 },
    chip: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: 8, borderWidth: 1.5, borderColor: p.seam },
    chipOn: { borderColor: p.text },
    chipLabel: { ...type.caption, fontFamily: fonts.medium, color: p.text },
    pressed: { backgroundColor: p.surface },
    dim: { opacity: 0.45 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    rowName: { ...type.body, color: p.text, flex: 1 },
    rowFolder: { fontFamily: fonts.medium },
    rowMeta: { ...type.caption, color: p.muted },
    rowCode: { ...type.caption, fontFamily: fonts.bold, color: p.muted, width: 24 },
    rowDir: { ...type.caption, color: p.muted },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: p.seam, marginLeft: space.lg },

    center: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xxl, gap: space.md },
    centerTitle: { ...type.title, color: p.text },
    centerText: { ...type.body, color: p.muted },
    centerActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },

    code: { paddingVertical: space.md },
    line: { flexDirection: 'row', paddingRight: space.lg },
    lineNo: { ...mono, color: p.muted, width: 52, textAlign: 'right', paddingRight: space.md },
    lineText: { ...mono, color: p.text, flex: 1 },
    lineTarget: { backgroundColor: p.surface },
    note: { ...type.caption, color: p.muted, paddingHorizontal: space.lg, paddingVertical: space.sm },
    prose: { padding: space.xl },

    diffHead: { ...type.caption, color: p.muted },
    diffStat: { ...type.caption, fontFamily: fonts.medium, color: p.text },
    diffRow: { flexDirection: 'row', paddingRight: space.lg },
    diffAdded: { backgroundColor: p.addedBg },
    diffRemoved: { backgroundColor: p.removedBg },
    diffNo: { ...mono, color: p.muted, width: 40, textAlign: 'right', paddingRight: space.xs },
    diffMarker: { ...mono, color: p.muted, width: 18, textAlign: 'center' },
    diffText: { ...mono, color: p.text, flex: 1 },
    changedAdded: { backgroundColor: p.addedMark },
    changedRemoved: { backgroundColor: p.removedMark },
    bold: { fontFamily: fonts.bold },
    italic: { fontStyle: 'italic' },
    diffMarkerAdded: { color: p.added, fontFamily: fonts.bold },
    diffMarkerRemoved: { color: p.removed, fontFamily: fonts.bold },
    diffHunk: { ...mono, color: p.muted, paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: p.surface },

    address: {
      ...type.body,
      flex: 1,
      color: p.text,
      paddingHorizontal: space.md,
      paddingVertical: 8,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    navButton: { paddingVertical: space.xs, paddingHorizontal: space.sm },
    navLabel: { ...type.bodyBold, color: p.text },
    web: { flex: 1, backgroundColor: p.bg },

    solid: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: p.text },
    solidLabel: { ...type.bodyBold, color: p.bg },
    quiet: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    quietLabel: { ...type.bodyBold, color: p.text },
  });
}
