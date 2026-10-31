import { memo, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, space, type, type Palette } from '../theme/tokens';
import { parseBlocks } from './markdownBlocks';

function inline(text: string, s: Styles): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) out.push(<Text key={key++} style={s.inlineCode}>{token.slice(1, -1)}</Text>);
    else out.push(<Text key={key++} style={s.strong}>{token.slice(2, -2)}</Text>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const Markdown = memo(function MarkdownView({ text, palette, muted }: { text: string; palette: Palette; muted?: boolean }) {
  const s = useMemo(() => makeStyles(palette, muted === true), [palette, muted]);
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={s.root}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'code':
            return (
              <ScrollView key={index} horizontal style={s.code} contentContainerStyle={s.codeContent} showsHorizontalScrollIndicator={false}>
                <Text style={s.codeText} selectable>{block.text}</Text>
              </ScrollView>
            );
          case 'heading':
            return <Text key={index} style={s.heading} selectable>{inline(block.text, s)}</Text>;
          case 'item':
            return (
              <View key={index} style={[s.item, { paddingLeft: block.depth * space.lg }]}>
                <Text style={s.marker}>{block.marker}</Text>
                <Text style={s.body} selectable>{inline(block.text, s)}</Text>
              </View>
            );
          case 'quote':
            return <Text key={index} style={[s.body, s.quote]} selectable>{inline(block.text, s)}</Text>;
          case 'para':
            return <Text key={index} style={s.body} selectable>{inline(block.text, s)}</Text>;
        }
      })}
    </View>
  );
});

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette, muted: boolean) {
  const color = muted ? p.muted : p.text;
  return StyleSheet.create({
    root: { gap: space.sm },
    body: { ...type.body, color, flexShrink: 1 },
    strong: { fontFamily: fonts.bold },
    inlineCode: { fontFamily: fonts.medium, backgroundColor: p.surface, color },
    heading: { ...type.bodyBold, color, marginTop: space.xs },
    item: { flexDirection: 'row', gap: space.sm },
    marker: { ...type.body, color: p.muted, minWidth: 14 },
    quote: { color: p.muted, borderLeftWidth: 2, borderLeftColor: p.seam, paddingLeft: space.md },
    code: { backgroundColor: p.surface, borderRadius: radius.sm },
    codeContent: { padding: space.md },
    codeText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: p.text },
  });
}
