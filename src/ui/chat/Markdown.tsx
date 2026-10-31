import Clipboard from '@react-native-clipboard/clipboard';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { highlightCode, type RuntimeSyntaxSpan } from 'react-native-whip-ssh';

import { fonts, radius, space, type, type Palette } from '../theme/tokens';
import { fileLink, linkFiles, type FileLink } from './fileLinks';
import { parseBlocks, type Block } from './markdownBlocks';

type OpenFile = (link: FileLink) => void;

function inline(text: string, s: Styles, onOpenFile: OpenFile | undefined, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  const prose = (value: string) => {
    if (!onOpenFile) return out.push(value);
    for (const part of linkFiles(value)) {
      if (typeof part === 'string') out.push(part);
      else out.push(<Text key={`${key}.${index++}`} style={s.link} onPress={() => onOpenFile(part.link)}>{part.text}</Text>);
    }
  };
  while ((match = pattern.exec(text))) {
    if (match.index > last) prose(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = token.slice(1, -1);
      const link = onOpenFile ? fileLink(code) : null;
      out.push(
        <Text
          key={`${key}.${index++}`}
          style={[s.inlineCode, link && s.link]}
          onPress={link && onOpenFile ? () => onOpenFile(link) : undefined}
        >
          {code}
        </Text>,
      );
    } else out.push(<Text key={`${key}.${index++}`} style={s.strong}>{token.slice(2, -2)}</Text>);
    last = match.index + token.length;
  }
  if (last < text.length) prose(text.slice(last));
  return out;
}

type Run =
  | { kind: 'prose'; blocks: Exclude<Block, { kind: 'code' }>[] }
  | { kind: 'code'; block: Extract<Block, { kind: 'code' }> };

/**
 * Prose between code blocks is one `Text`, so a selection can run across
 * paragraphs and list items; Android cannot select across separate texts.
 */
function runs(blocks: Block[]): Run[] {
  const out: Run[] = [];
  for (const block of blocks) {
    const previous = out[out.length - 1];
    if (block.kind === 'code') out.push({ kind: 'code', block });
    else if (previous?.kind === 'prose') previous.blocks.push(block);
    else out.push({ kind: 'prose', blocks: [block] });
  }
  return out;
}

export const Markdown = memo(function MarkdownView({ text, palette, muted, onOpenFile }: {
  text: string;
  palette: Palette;
  muted?: boolean;
  /** Makes file paths in the text tappable. */
  onOpenFile?: OpenFile;
}) {
  const s = useMemo(() => makeStyles(palette, muted === true), [palette, muted]);
  const parts = useMemo(() => runs(parseBlocks(text)), [text]);
  return (
    <View style={s.root}>
      {parts.map((run, index) => (run.kind === 'code'
        ? <CodeBlock key={index} text={run.block.text} lang={run.block.lang} palette={palette} s={s} />
        : <Prose key={index} blocks={run.blocks} s={s} onOpenFile={onOpenFile} />))}
    </View>
  );
});

function Prose({ blocks, s, onOpenFile }: { blocks: Exclude<Block, { kind: 'code' }>[]; s: Styles; onOpenFile?: OpenFile }) {
  return (
    <Text style={s.body} selectable>
      {blocks.map((block, index) => {
        const key = String(index);
        // List items sit on consecutive lines; everything else is a paragraph apart.
        const gap = index === 0 ? '' : block.kind === 'item' && blocks[index - 1].kind === 'item' ? '\n' : '\n\n';
        switch (block.kind) {
          case 'heading':
            return <Text key={key}>{gap}<Text style={s.heading}>{inline(block.text, s, onOpenFile, key)}</Text></Text>;
          case 'item':
            return (
              <Text key={key}>
                {gap}{'   '.repeat(block.depth)}<Text style={s.marker}>{block.marker}</Text>{' '}
                {inline(block.text, s, onOpenFile, key)}
              </Text>
            );
          case 'quote':
            return <Text key={key}>{gap}<Text style={s.quoteBar}>{'▎ '}</Text><Text style={s.quote}>{inline(block.text, s, onOpenFile, key)}</Text></Text>;
          case 'para':
            return <Text key={key}>{gap}{inline(block.text, s, onOpenFile, key)}</Text>;
        }
      })}
    </Text>
  );
}

/** A fenced block: scrolls sideways, colored when its language is known, with a copy button. */
function CodeBlock({ text, lang, palette, s }: { text: string; lang: string; palette: Palette; s: Styles }) {
  const [spans, setSpans] = useState<readonly RuntimeSyntaxSpan[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    setSpans([]);
    if (lang) {
      highlightCode(text, lang).then(
        value => { if (live) setSpans(value[palette.scheme]); },
        () => { /* Plain text is a fine fallback. */ },
      );
    }
    return () => { live = false; };
  }, [lang, palette.scheme, text]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <View style={s.code}>
      <ScrollView horizontal contentContainerStyle={s.codeContent} showsHorizontalScrollIndicator={false}>
        <Text style={s.codeText} selectable>
          {spans.length === 0 ? text : colored(text, spans)}
        </Text>
      </ScrollView>
      <Pressable
        onPress={() => {
          Clipboard.setString(text);
          setCopied(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied' : 'Copy code'}
        hitSlop={8}
        style={({ pressed }) => [s.copy, pressed && s.copyPressed]}
      >
        <Text style={s.copyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
}

/** Spans cover the text in order; offsets are UTF-16, as JavaScript indexes strings. */
function colored(text: string, spans: readonly RuntimeSyntaxSpan[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach((span, index) => {
    if (span.start > at) out.push(text.slice(at, span.start));
    out.push(
      <Text
        key={index}
        style={{
          color: span.color,
          fontFamily: span.bold ? fonts.bold : undefined,
          fontStyle: span.italic ? 'italic' : undefined,
        }}
      >
        {text.slice(span.start, span.end)}
      </Text>,
    );
    at = Math.max(at, span.end);
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette, muted: boolean) {
  const color = muted ? p.muted : p.text;
  return StyleSheet.create({
    root: { gap: space.sm },
    body: { ...type.body, color, flexShrink: 1 },
    strong: { fontFamily: fonts.bold },
    inlineCode: { fontFamily: fonts.medium, backgroundColor: p.surface, color },
    link: { textDecorationLine: 'underline', textDecorationColor: p.muted },
    heading: { fontFamily: fonts.bold },
    marker: { color: p.muted },
    quoteBar: { color: p.seam },
    quote: { color: p.muted },
    code: { backgroundColor: p.surface, borderRadius: radius.sm },
    // Room on the right so the first line is not hidden under the button.
    codeContent: { padding: space.md, paddingRight: space.md + 56 },
    codeText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: p.text },
    copy: {
      position: 'absolute',
      top: space.xs,
      right: space.xs,
      paddingVertical: 3,
      paddingHorizontal: space.sm,
      borderRadius: 6,
      backgroundColor: p.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.seam,
    },
    copyPressed: { opacity: 0.6 },
    copyLabel: { ...type.caption, fontSize: 11, lineHeight: 14, color: p.muted },
  });
}
