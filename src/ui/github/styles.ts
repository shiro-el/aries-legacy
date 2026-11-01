import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, space, type, usePalette, type Palette } from '../theme/tokens';

export function useGithubStyles() {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  return { palette, s };
}
export type GithubStyles = ReturnType<typeof makeStyles>;
function makeStyles(p: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
    stack: { gap: space.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    header: { padding: space.lg, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.seam },
    title: { ...type.title, color: p.text, flexShrink: 1 },
    body: { ...type.body, color: p.text },
    strong: { ...type.bodyBold, color: p.text },
    muted: { ...type.caption, color: p.muted, flexShrink: 1 },
    error: { ...type.body, color: p.removed },
    button: { minHeight: 44, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', backgroundColor: p.surface },
    buttonText: { ...type.caption, color: p.text },
    selected: { borderBottomWidth: 2, borderColor: p.text },
    dim: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
    tabs: { flexDirection: 'row', gap: space.xs },
    input: { ...type.body, color: p.text, backgroundColor: p.surface, borderRadius: radius.sm, padding: space.md, minHeight: 44 },
    listRow: { padding: space.lg, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.seam },
    section: { gap: space.md, paddingVertical: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.seam },
    author: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: p.surface },
    editor: { borderWidth: 1, borderColor: p.seam, borderRadius: radius.sm, overflow: 'hidden' },
    editorBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.seam },
    draft: { ...type.body, color: p.text, minHeight: 160, padding: space.md, textAlignVertical: 'top' },
    preview: { minHeight: 160, padding: space.md },
    hint: { ...type.caption, color: p.muted, padding: space.md },
    patch: { ...type.caption, color: p.text, padding: space.md, backgroundColor: p.surface },
    center: { padding: space.xxl, gap: space.md, alignItems: 'center' },
  });
}
