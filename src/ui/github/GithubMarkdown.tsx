import { useMemo } from 'react';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { fonts, type, usePalette } from '../theme/tokens';

/** GitHub prose needs tables, task lists and links as well as code fences. */
export function GithubMarkdown({ text, onOpenLink }: { text: string; onOpenLink: (url: string) => void }) {
  const p = usePalette();
  const style = useMemo<MarkdownStyle>(() => ({
    paragraph: { ...type.body, color: p.text, marginBottom: 10 },
    h1: { ...type.title, color: p.text },
    h2: { ...type.title, fontSize: 18, color: p.text },
    h3: { ...type.bodyBold, color: p.text },
    h4: { ...type.bodyBold, color: p.text },
    h5: { ...type.bodyBold, color: p.text },
    h6: { ...type.bodyBold, color: p.muted },
    list: { ...type.body, color: p.text, bulletColor: p.muted, markerColor: p.muted },
    link: { color: p.text, underline: true },
    strong: { fontFamily: fonts.bold },
    code: { fontFamily: fonts.regular, color: p.text, backgroundColor: p.surface },
    codeBlock: { fontFamily: fonts.regular, fontSize: 12, color: p.text, backgroundColor: p.surface },
    blockquote: { color: p.muted, borderColor: p.seam, borderWidth: 2 },
    table: { color: p.text, borderColor: p.seam, headerBackgroundColor: p.surface, fontFamily: fonts.regular },
    thematicBreak: { color: p.seam },
  }), [p]);
  return <EnrichedMarkdownText markdown={text} markdownStyle={style} selectable onLinkPress={({ url }) => onOpenLink(url)} />;
}
