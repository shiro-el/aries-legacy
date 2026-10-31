import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  highlightCode,
  type HostRuntimeConnection,
  type RuntimeRemoteFileEntry,
  type RuntimeRemoteTextReader,
  type RuntimeSyntaxSpan,
} from 'react-native-whip-ssh';

import { MAX_REMOTE_TEXT_PREVIEW_BYTES, formatRemoteFileSize, remotePreviewKind } from '../../lib/remoteFiles';
import { svgPreviewHtml } from '../../lib/svgPreview';
import { Markdown } from '../chat/Markdown';
import type { Palette } from '../theme/tokens';
import { Chip, CodeFrame, Notice, Segments, errorText } from './parts';
import { codeSegments, spansByLine, type CodeSegment } from './syntax';
import type { WorkbenchStyles } from './styles';
import { pdfPreviewHtml } from './pdfPreview';
import { useHostPreview } from './useHostPreview';
import { codeColumns, codeText, loadsInBrowser, previewMode } from './workbench';

type Props = {
  native: HostRuntimeConnection | null;
  entry: RuntimeRemoteFileEntry;
  s: WorkbenchStyles;
  palette: Palette;
};

type PreviewProps = Props & {
  /** A 1-based line to bring into view, as from a link in the chat. */
  line?: number;
};

type Line = { key: string; no: number | null; text: string; segments?: CodeSegment[] };

/** Shows one remote file in the way its type reads best on a phone. */
export function FilePreview({ native, entry, s, palette, line }: PreviewProps) {
  const kind = remotePreviewKind(entry.name, entry.size);
  const mode = previewMode(kind);
  const [source, setSource] = useState(false);
  const [wrap, setWrap] = useState(true);
  const showsText = mode !== 'none' && (source || mode === 'text');

  const header = (
    <View style={s.toolbar}>
      <Text style={s.rowMeta} numberOfLines={1}>
        {entry.size !== undefined ? formatRemoteFileSize(entry.size) : ''}
      </Text>
      <View style={s.spacer} />
      {showsText && <Chip s={s} label="Wrap" on={wrap} onPress={() => setWrap(value => !value)} />}
      {(mode === 'markdown' || mode === 'svg' || mode === 'html') && (
        <Chip s={s} label="Source" on={source} onPress={() => setSource(value => !value)} />
      )}
    </View>
  );

  let body;
  if (mode === 'none') {
    body = (
      <Notice
        s={s}
        palette={palette}
        title="No preview"
        text="Aries cannot show this type of file. Open it from the terminal instead."
      />
    );
  } else if (showsText) {
    body = kind === 'paged-text'
      ? <PagedText native={native} entry={entry} s={s} palette={palette} wrap={wrap} />
      : <WholeText native={native} entry={entry} s={s} palette={palette} wrap={wrap} line={line} />;
  } else if (mode === 'markdown') {
    body = <TextDocument native={native} entry={entry} s={s} palette={palette} render={text => (
      <ScrollView contentContainerStyle={s.prose}>
        <Markdown text={text} palette={palette} />
      </ScrollView>
    )} />;
  } else if (mode === 'svg') {
    body = <TextDocument native={native} entry={entry} s={s} palette={palette} render={text => (
      <SafeWeb s={s} source={{ html: svgPreviewHtml(text) }} />
    )} />;
  } else {
    body = <ServedFile native={native} entry={entry} kind={kind} s={s} palette={palette} />;
  }

  return (
    <View style={s.fill}>
      {header}
      {body}
    </View>
  );
}

function useRemoteText(native: HostRuntimeConnection | null, path: string) {
  const [text, setText] = useState<{ value: string } | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setText(null);
    if (!native) {
      setText({ error: 'The host is not connected.' });
      return;
    }
    native.readRemoteText(path, MAX_REMOTE_TEXT_PREVIEW_BYTES).then(
      value => { if (live) setText({ value }); },
      (reason: unknown) => { if (live) setText({ error: errorText(reason) }); },
    );
    return () => { live = false; };
  }, [attempt, native, path]);
  return { text, retry: () => setAttempt(value => value + 1) };
}

function TextDocument({ native, entry, s, palette, render }: Props & { render: (text: string) => ReactElement }) {
  const { text, retry } = useRemoteText(native, entry.path);
  if (!text) return <Notice s={s} palette={palette} busy />;
  if ('error' in text) {
    return <Notice s={s} palette={palette} title="Can't read this file" text={text.error} action={{ label: 'Try again', onPress: retry }} />;
  }
  try {
    return render(text.value);
  } catch (reason) {
    return <Notice s={s} palette={palette} title="Can't show this file" text={errorText(reason)} />;
  }
}

function WholeText({ native, entry, s, palette, wrap, line }: Props & { wrap: boolean; line?: number }) {
  return <TextDocument native={native} entry={entry} s={s} palette={palette} render={text => (
    <HighlightedText text={text} name={entry.name} s={s} palette={palette} wrap={wrap} line={line} />
  )} />;
}

/** Shows the text at once and colors it when the host-side highlighter answers. */
function HighlightedText({ text, name, s, palette, wrap, line }: {
  text: string;
  name: string;
  s: WorkbenchStyles;
  palette: Palette;
  wrap: boolean;
  line?: number;
}) {
  const [syntax, setSyntax] = useState<readonly RuntimeSyntaxSpan[]>([]);
  useEffect(() => {
    let live = true;
    setSyntax([]);
    highlightCode(text, name).then(
      value => { if (live) setSyntax(value[palette.scheme]); },
      () => { /* Plain text is a fine fallback. */ },
    );
    return () => { live = false; };
  }, [name, palette.scheme, text]);
  const lines = useMemo(() => {
    const values = text.split('\n');
    const spans = spansByLine(text, syntax);
    if (values.length > 1 && values[values.length - 1] === '') values.pop();
    return values.map((value, index): Line => ({
      key: String(index),
      no: index + 1,
      text: value,
      segments: codeSegments(value, spans[index]),
    }));
  }, [syntax, text]);
  return <Lines s={s} wrap={wrap} lines={lines} line={line} />;
}

/** Files past the whole-read limit arrive a page at a time as the list scrolls. */
function PagedText({ native, entry, s, palette, wrap }: Props & { wrap: boolean }) {
  const reader = useRef<RuntimeRemoteTextReader | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [page, setPage] = useState<{ next: number; eof: boolean; busy: boolean; error: string | null }>(
    { next: 0, eof: false, busy: true, error: null },
  );

  const read = useCallback(async (index: number) => {
    const current = reader.current;
    if (!current) return;
    setPage(value => ({ ...value, busy: true, error: null }));
    try {
      const result = await current.readPage(index);
      if (reader.current !== current) return;
      setLines(value => [...value, ...result.rows.map((row, offset) => ({
        key: `${index}:${offset}`,
        no: row.continued ? null : row.lineNumber,
        text: row.text,
      }))]);
      setPage({ next: index + 1, eof: result.eof, busy: false, error: null });
    } catch (reason) {
      if (reader.current === current) setPage(value => ({ ...value, busy: false, error: errorText(reason) }));
    }
  }, []);

  useEffect(() => {
    let live = true;
    setLines([]);
    setPage({ next: 0, eof: false, busy: true, error: null });
    if (!native || entry.size === undefined) {
      setPage({ next: 0, eof: true, busy: false, error: 'The host is not connected.' });
      return;
    }
    native.openRemoteTextReader(entry.path, entry.size, entry.modifiedAt).then(
      opened => {
        if (!live) {
          opened.close();
          return;
        }
        reader.current = opened;
        void read(0);
      },
      (reason: unknown) => {
        if (live) setPage({ next: 0, eof: true, busy: false, error: errorText(reason) });
      },
    );
    return () => {
      live = false;
      reader.current?.close();
      reader.current = null;
    };
  }, [entry.modifiedAt, entry.path, entry.size, native, read]);

  if (lines.length === 0) {
    if (page.error) return <Notice s={s} palette={palette} title="Can't read this file" text={page.error} />;
    return <Notice s={s} palette={palette} busy />;
  }
  return (
    <Lines
      s={s}
      wrap={wrap}
      lines={lines}
      onEndReached={() => {
        if (!page.busy && !page.eof && !page.error) void read(page.next);
      }}
      footer={page.error ? <Text style={s.note}>{page.error}</Text> : page.busy ? <Text style={s.note}>Reading more</Text> : undefined}
    />
  );
}

function Lines({ s, wrap, lines, line, onEndReached, footer }: {
  s: WorkbenchStyles;
  wrap: boolean;
  lines: Line[];
  /** A 1-based line to bring into view first, as from a link in the chat. */
  line?: number;
  onEndReached?: () => void;
  footer?: ReactElement;
}) {
  const columns = useMemo(() => (wrap ? 0 : lines.reduce((most, item) => Math.max(most, codeColumns(item.text)), 0)), [lines, wrap]);
  const list = useRef<FlatList<Line>>(null);
  const target = line !== undefined && line > 0 ? Math.min(line, lines.length) - 1 : null;
  const reached = useRef(false);
  useEffect(() => {
    if (target === null || reached.current || lines.length === 0) return;
    reached.current = true;
    const timer = setTimeout(() => list.current?.scrollToIndex({ index: target, viewPosition: 0.3, animated: false }), 0);
    return () => clearTimeout(timer);
  }, [lines.length, target]);
  return (
    <CodeFrame wrap={wrap} columns={columns} gutter={LINE_GUTTER}>
      <FlatList
        ref={list}
        data={lines}
        onScrollToIndexFailed={failed => {
          // Rows have not been measured that far yet: jump near it, then aim again.
          list.current?.scrollToOffset({ offset: failed.averageItemLength * failed.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: failed.index, viewPosition: 0.3, animated: false }), 50);
        }}
        keyExtractor={item => item.key}
        contentContainerStyle={s.code}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        initialNumToRender={60}
        ListFooterComponent={footer}
        renderItem={({ item }) => (
          <View style={[s.line, target !== null && item.no === target + 1 && s.lineTarget]}>
            <Text style={s.lineNo}>{item.no ?? ''}</Text>
            <Text style={s.lineText} selectable>
              {item.segments ? <Segments s={s} segments={item.segments} /> : codeText(item.text) || ' '}
            </Text>
          </View>
        )}
      />
    </CodeFrame>
  );
}

/** Line number column plus the row's right padding, matching `s.lineNo` and `s.line`. */
const LINE_GUTTER = 52 + 16;

/** HTML is served from its folder so relative assets load; media streams over SFTP. */
function ServedFile({ native, entry, kind, s, palette }: Props & { kind: ReturnType<typeof remotePreviewKind> }) {
  const preview = useHostPreview(native, entry.path, runtime =>
    kind === 'html' ? runtime.startHtmlPreview(entry.path) : runtime.startRemoteFilePreview(entry.path));
  if (!preview || preview.state === 'starting') return <Notice s={s} palette={palette} busy text="Opening a tunnel to the host" />;
  if (preview.state === 'failed') return <Notice s={s} palette={palette} title="Can't open this file" text={preview.error} />;
  if (kind === 'html') return <SafeWeb s={s} source={{ uri: preview.url }} />;
  if (kind === 'pdf') return <SafeWeb s={s} source={{ html: pdfPreviewHtml(preview.url, palette), baseUrl: preview.url }} />;
  return <SafeWeb s={s} source={{ html: mediaHtml(kind, preview.url, palette), baseUrl: preview.url }} />;
}

export function SafeWeb({ s, source }: { s: WorkbenchStyles; source: { uri: string } | { html: string; baseUrl?: string } }) {
  return (
    <WebView
      style={s.web}
      source={source}
      originWhitelist={['http://*', 'https://*', 'about:*', 'data:*']}
      onShouldStartLoadWithRequest={request => loadsInBrowser(request.url)}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      setSupportMultipleWindows={false}
    />
  );
}

function mediaHtml(kind: string, url: string, palette: Palette): string {
  const src = url.replace(/"/g, '&quot;');
  const element = kind === 'video'
    ? `<video controls playsinline src="${src}"></video>`
    : kind === 'audio'
      ? `<audio controls src="${src}"></audio>`
      : `<img alt="" src="${src}">`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes">
<style>html,body{margin:0;height:100%;background:${palette.bg}}
body{display:flex;align-items:center;justify-content:center}
img,video{max-width:100%;max-height:100%;object-fit:contain}audio{width:90%}</style>
</head><body>${element}</body></html>`;
}
