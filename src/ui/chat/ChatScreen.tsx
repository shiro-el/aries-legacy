import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeAgentInteractionPrompt } from 'react-native-whip-ssh';

import type { TranscriptToolPart, TranscriptTurn } from '../../agentChat';
import { chatAgentDisplayName, chatAgentForPane } from '../../lib/agentChatSession';
import type { ChatBlock } from '../../lib/nativeChatRows';
import type { HerdrClient } from '../../services/HerdrClient';
import type { PaneInfo } from '../../types';
import { StatusGlyph } from '../herd/StatusGlyph';
import { fonts, radius, space, type, usePalette, type Palette } from '../theme/tokens';
import { Composer } from './Composer';
import type { FileLink } from './fileLinks';
import { Markdown } from './Markdown';
import { useAgentChat } from './useAgentChat';

type Props = {
  hostSessionId: string;
  hostName: string;
  pane: PaneInfo | undefined;
  client: HerdrClient | undefined;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onOpenTerminal: () => void;
  /** The project screen: files, changes and a browser for this pane's folder. */
  onOpenProject: () => void;
  /** Opens a file the agent named, in the project screen. */
  onOpenFile: (link: FileLink) => void;
  /** This chat is the one on screen, not a retained hidden one. */
  active: boolean;
  /** Put the caret in the composer, as after starting a new task. */
  focusComposer?: boolean;
};

export function ChatScreen({
  hostSessionId, hostName, pane, client, onRefresh, onBack, onOpenTerminal, onOpenProject, onOpenFile, active, focusComposer,
}: Props) {
  const palette = usePalette();
  const s = useMemo(() => makeStyles(palette), [palette]);
  const chat = useAgentChat({ hostSessionId, pane, client, onRefresh });
  const [openTools, setOpenTools] = useState<ReadonlySet<string>>(() => new Set());
  const agent = chatAgentForPane(pane);
  const name = agent ? chatAgentDisplayName(agent) : (pane?.display_agent ?? pane?.agent ?? 'Agent');
  const where = pane?.foreground_cwd ?? pane?.cwd;
  const paneId = pane?.pane_id;
  // Null until the runtime attaches and again after it disconnects.
  const native = client?.activeNative ?? null;
  const catalogSource = useMemo(
    () => (native && paneId ? { key: hostSessionId, paneId, native } : null),
    [hostSessionId, native, paneId],
  );

  // Rows are memoized; the parent's handler changes every render, this one never does.
  const openFileHandler = useRef(onOpenFile);
  openFileHandler.current = onOpenFile;
  const openFile = useCallback((link: FileLink) => openFileHandler.current(link), []);

  const toggleTool = useCallback((id: string) => {
    setOpenTools(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const data = useMemo(() => [...chat.blocks].reverse(), [chat.blocks]);

  return (
    <View style={s.screen}>
      <View style={s.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to herd" hitSlop={8}>
          <Text style={s.back}>‹ Herd</Text>
        </Pressable>
        <View style={s.titleWrap}>
          <View style={s.titleRow}>
            {pane && <StatusGlyph status={pane.agent_status} palette={palette} />}
            <Text style={s.title} numberOfLines={1}>{name}</Text>
          </View>
          <Text style={s.where} numberOfLines={1}>{where ? `${hostName}  ${where}` : hostName}</Text>
        </View>
        <Pressable onPress={onOpenProject} disabled={!native} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [s.mode, pressed && s.pressed, !native && s.dim]}>
          <Text style={s.modeLabel}>Project</Text>
        </Pressable>
      </View>

      <ChatBody chat={chat} name={name} s={s} palette={palette} onOpenTerminal={onOpenTerminal}>
        <FlatList
          inverted
          data={data}
          keyExtractor={block => block.id}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={chat.working ? <Working name={name} s={s} palette={palette} /> : undefined}
          renderItem={({ item }) => (
            <Row
              block={item}
              palette={palette}
              s={s}
              toolOpen={openTools.has(item.id)}
              onToggleTool={toggleTool}
              changesOpen={chat.expanded.has(JSON.stringify([item.turnId, 'changes']))}
              onToggleChanges={chat.toggle}
              onOpenFile={native ? openFile : undefined}
            />
          )}
        />
      </ChatBody>

      {chat.prompt.prompt && (
        <PromptCard
          prompt={chat.prompt.prompt}
          name={name}
          busy={chat.prompt.busy}
          error={chat.prompt.error}
          s={s}
          palette={palette}
          onRespond={(action, answer) => { void chat.prompt.respond(action, answer); }}
        />
      )}
      {!chat.prompt.prompt && chat.prompt.error && <Text style={s.promptError}>{chat.prompt.error}</Text>}
      <Composer
        name={name}
        agent={agent}
        catalogSource={catalogSource}
        paneContext={JSON.stringify([where, pane?.agent])}
        active={active}
        disabled={!pane || !client}
        autoFocus={focusComposer}
        palette={palette}
        onSend={chat.send}
        onOpenTerminal={onOpenTerminal}
      />
    </View>
  );
}

type Chat = ReturnType<typeof useAgentChat>;

/** Chooses between the transcript and the state that keeps it from showing. */
function ChatBody({ chat, name, s, palette, onOpenTerminal, children }: {
  chat: Chat;
  name: string;
  s: Styles;
  palette: Palette;
  onOpenTerminal: () => void;
  children: ReactElement;
}) {
  if (chat.awaitingSession) {
    return (
      <View style={s.center}>
        <Text style={s.centerTitle}>No conversation yet</Text>
        <Text style={s.centerText}>
          {name} has not started a conversation in this pane. Send a message below, and the conversation shows up here once {name} saves it.
        </Text>
      </View>
    );
  }
  const notice = chat.notice;
  if (notice) {
    const title = notice.type === 'integration'
      ? `${name} chat needs the Herdr integration`
      : notice.title;
    const message = notice.type === 'integration'
      ? `Install it on the host so Aries can read ${name}'s conversation. The agent keeps running.`
      : notice.message;
    return (
      <View style={s.center}>
        <Text style={s.centerTitle}>{title}</Text>
        <Text style={s.centerText}>{message}</Text>
        <View style={s.centerActions}>
          {notice.type === 'integration' ? (
            <Pressable onPress={chat.install} disabled={chat.installing} accessibilityRole="button" style={[s.solid, chat.installing && s.dim]}>
              <Text style={s.solidLabel}>{chat.installing ? 'Installing' : 'Install integration'}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={chat.retry} accessibilityRole="button" style={s.solid}>
              <Text style={s.solidLabel}>Try again</Text>
            </Pressable>
          )}
          <Pressable onPress={onOpenTerminal} accessibilityRole="button" style={s.quiet}>
            <Text style={s.quietLabel}>Open terminal</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (!chat.binding || !chat.settled) {
    const failed = chat.state.status === 'error' || chat.state.status === 'unavailable' || chat.rowsError;
    return (
      <View style={s.center}>
        <Text style={s.centerText}>
          {failed
            ? chat.rowsError ?? chat.state.error ?? `Could not read ${name}'s conversation.`
            : `Reading ${name}'s conversation`}
        </Text>
        {failed && (
          <Pressable onPress={chat.retry} accessibilityRole="button" style={s.solid}>
            <Text style={s.solidLabel}>Try again</Text>
          </Pressable>
        )}
        {!failed && <Working name={name} s={s} palette={palette} quiet />}
      </View>
    );
  }
  if (chat.blocks.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.centerText}>No messages yet. Write to {name} below to start.</Text>
      </View>
    );
  }
  return children;
}

function Working({ name, s, palette, quiet }: { name: string; s: Styles; palette: Palette; quiet?: boolean }) {
  return (
    <View style={[s.working, quiet && s.workingQuiet]}>
      <StatusGlyph status="working" palette={palette} />
      {!quiet && <Text style={s.workingText}>{name} is working</Text>}
    </View>
  );
}

const Row = memo(function ChatRowView({ block, palette, s, toolOpen, onToggleTool, changesOpen, onToggleChanges, onOpenFile }: {
  block: ChatBlock;
  palette: Palette;
  s: Styles;
  toolOpen: boolean;
  onToggleTool: (id: string) => void;
  changesOpen: boolean;
  onToggleChanges: (key: string) => void;
  onOpenFile?: (link: FileLink) => void;
}) {
  const gap = block.spacing === 'turn' ? s.gapTurn : block.spacing === 'part' ? s.gapPart : null;
  switch (block.type) {
    case 'user': {
      const text = block.message.parts
        .flatMap(part => (part.type === 'text' ? [part.text] : part.type === 'image' ? ['[image]'] : []))
        .join('\n');
      return (
        <View style={[s.user, gap]}>
          <Text style={s.prompt}>{'>'}</Text>
          <Text style={s.userText} selectable>{text}</Text>
        </View>
      );
    }
    case 'error':
      return <Text style={[s.errorText, gap]} selectable>{block.error}</Text>;
    case 'part': {
      const part = block.part;
      switch (part.type) {
        case 'text':
          return <View style={gap}><Markdown text={part.text} palette={palette} onOpenFile={onOpenFile} /></View>;
        case 'reasoning':
          return (
            <Pressable onPress={() => onToggleTool(block.id)} style={gap} accessibilityRole="button" accessibilityState={{ expanded: toolOpen }}>
              <Text style={s.aside}>{toolOpen ? 'Thinking' : 'Thinking, tap to read'}</Text>
              {toolOpen && <Markdown text={part.text} palette={palette} muted />}
            </Pressable>
          );
        case 'plan':
          return (
            <View style={[s.plan, gap]}>
              <Text style={s.planLabel}>Plan</Text>
              <Markdown text={part.text} palette={palette} onOpenFile={onOpenFile} />
            </View>
          );
        case 'notice':
          return <Text style={[part.level === 'info' ? s.aside : s.errorText, gap]}>{part.text}</Text>;
        case 'tool':
          return <Tool part={part} open={toolOpen} onToggle={() => onToggleTool(block.id)} s={s} palette={palette} style={gap} />;
        case 'image':
          return <Text style={[s.aside, gap]}>Image</Text>;
      }
      return null;
    }
    case 'changes':
      return (
        <Pressable
          onPress={() => onToggleChanges(JSON.stringify([block.turnId, 'changes']))}
          accessibilityRole="button"
          accessibilityState={{ expanded: changesOpen }}
          style={[s.changes, gap]}
        >
          <Text style={s.changesText}>{changesSummary(block.turn)}</Text>
          <Text style={s.aside}>{changesOpen ? 'Hide' : 'Show'}</Text>
        </Pressable>
      );
    case 'diff':
      return (
        <View style={[s.diff, gap]}>
          <Text style={s.diffFile} numberOfLines={1}>
            {block.file.file}  <Text style={s.aside}>+{block.file.additions} −{block.file.deletions}</Text>
          </Text>
          {block.file.patch ? <DiffPatch patch={block.file.patch} s={s} /> : null}
        </View>
      );
    case 'meta': {
      const details = block.turn.details;
      const parts = [details?.model, details?.usage?.total ? `${details.usage.total.toLocaleString()} tokens` : undefined, duration(block.turn)]
        .filter(Boolean);
      return parts.length ? <Text style={[s.meta, gap]}>{parts.join('   ')}</Text> : null;
    }
  }
});

function changesSummary(turn: TranscriptTurn): string {
  const additions = turn.diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const deletions = turn.diffs.reduce((sum, diff) => sum + diff.deletions, 0);
  const files = turn.diffs.length === 1 ? '1 file changed' : `${turn.diffs.length} files changed`;
  return `${files}  +${additions} −${deletions}`;
}

function duration(turn: TranscriptTurn): string | undefined {
  if (!turn.startedAt || !turn.completedAt) return undefined;
  const seconds = Math.round((turn.completedAt - turn.startedAt) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function DiffPatch({ patch, s }: { patch: string; s: Styles }) {
  const lines = patch.split('\n').filter(line => !line.startsWith('diff ') && !line.startsWith('index ')).slice(0, 400);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.patch}>
      <Text style={s.patchText} selectable>
        {lines.map((line, index) => (
          <Text key={index} style={line.startsWith('+') ? s.added : line.startsWith('-') ? s.removed : line.startsWith('@@') ? s.hunk : undefined}>
            {line}{'\n'}
          </Text>
        ))}
      </Text>
    </ScrollView>
  );
}

function toolSubject(part: TranscriptToolPart): string {
  const { state } = part;
  if (state.title) return state.title;
  const input = state.input;
  for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0];
  }
  const first = Object.values(input).find(value => typeof value === 'string');
  return typeof first === 'string' ? first.split('\n')[0] : '';
}

function Tool({ part, open, onToggle, s, palette, style }: {
  part: TranscriptToolPart;
  open: boolean;
  onToggle: () => void;
  s: Styles;
  palette: Palette;
  style: object | null;
}) {
  const { state } = part;
  const failed = state.status === 'error' || (state.exitCode !== undefined && state.exitCode !== 0);
  const output = state.error ?? state.output;
  const files = state.files.length ? `  +${state.files.reduce((n, f) => n + f.additions, 0)} −${state.files.reduce((n, f) => n + f.deletions, 0)}` : '';
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={[s.tool, style]}>
      <View style={s.toolHead}>
        <View style={s.toolGlyph}>
          <StatusGlyph status={state.status === 'running' ? 'working' : state.status === 'pending' ? 'unknown' : 'idle'} palette={palette} />
        </View>
        <Text style={s.toolName}>{part.tool}</Text>
        <Text style={s.toolSubject} numberOfLines={open ? undefined : 1}>{toolSubject(part)}{files}</Text>
        {failed && <Text style={s.toolFailed}>failed</Text>}
      </View>
      {open && output ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.toolOutput}>
          <Text style={s.toolOutputText} selectable>{output.length > 6000 ? `${output.slice(0, 6000)}\n…` : output}</Text>
        </ScrollView>
      ) : null}
    </Pressable>
  );
}

/** The one gold surface in chat: the agent is waiting on a decision. */
function PromptCard({ prompt, name, busy, error, s, palette, onRespond }: {
  prompt: NativeAgentInteractionPrompt;
  name: string;
  busy: boolean;
  error: string | null;
  s: Styles;
  palette: Palette;
  onRespond: (action: string, answer?: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <StatusGlyph status="blocked" palette={palette} />
        <Text style={s.cardTitle}>{prompt.summary || `${name} needs you`}</Text>
      </View>
      {prompt.text ? (
        <ScrollView style={s.cardScroll}>
          <Text style={s.cardText} selectable>{prompt.text}</Text>
        </ScrollView>
      ) : null}
      {prompt.kind === 'queued-question' && (
        <Pressable onPress={() => onRespond('open')} disabled={busy} accessibilityRole="button" style={[s.choice, s.choiceSelected]}>
          <Text style={s.choiceLabel}>Open question</Text>
        </Pressable>
      )}
      {prompt.kind !== 'queued-question' && prompt.choices.map(choice => (
        <Pressable
          key={choice.index}
          onPress={() => onRespond(`choice:${choice.index}`)}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [s.choice, choice.selected && s.choiceSelected, pressed && s.pressed, busy && s.dim]}
        >
          <Text style={s.choiceLabel}>{choice.label}</Text>
        </Pressable>
      ))}
      {prompt.kind === 'terminal' && prompt.choices.length === 0 && (
        <View style={s.answerRow}>
          <TextInput
            style={[s.input, s.answerInput]}
            value={answer}
            onChangeText={setAnswer}
            placeholder="Answer"
            placeholderTextColor={palette.muted}
            onSubmitEditing={() => { if (answer.trim()) onRespond('answer', answer); }}
          />
          <Pressable onPress={() => onRespond('answer', answer)} disabled={busy || !answer.trim()} accessibilityRole="button" style={[s.solid, (busy || !answer.trim()) && s.dim]}>
            <Text style={s.solidLabel}>Send</Text>
          </Pressable>
        </View>
      )}
      <View style={s.cardFoot}>
        {error ? <Text style={s.cardError}>{error}</Text> : <View />}
        <Pressable onPress={() => onRespond('esc')} disabled={busy} accessibilityRole="button" hitSlop={8}>
          <Text style={s.aside}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  const mono = { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.seam,
    },
    back: { ...type.bodyMedium, color: p.muted },
    titleWrap: { flex: 1, minWidth: 0 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    title: { ...type.bodyBold, color: p.text, flexShrink: 1 },
    where: { ...type.caption, color: p.muted, marginTop: 1 },
    mode: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: 8, borderWidth: 1.5, borderColor: p.seam },
    modeLabel: { ...type.caption, fontFamily: fonts.medium, color: p.text },
    pressed: { backgroundColor: p.surface },
    dim: { opacity: 0.45 },

    list: { paddingHorizontal: space.xl, paddingVertical: space.lg },
    gapTurn: { marginTop: space.xl },
    gapPart: { marginTop: space.md },

    user: {
      flexDirection: 'row',
      gap: space.sm,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      marginHorizontal: -space.md,
      borderRadius: radius.sm,
      backgroundColor: p.surface,
    },
    prompt: { ...type.bodyBold, color: p.muted, fontVariant: ['no-contextual'] },
    userText: { ...type.bodyMedium, color: p.text, flex: 1 },
    aside: { ...type.caption, color: p.muted },
    errorText: { ...type.body, color: p.text, borderLeftWidth: 2, borderLeftColor: p.text, paddingLeft: space.md },
    plan: { gap: space.xs, borderLeftWidth: 2, borderLeftColor: p.seam, paddingLeft: space.md },
    planLabel: { ...type.caption, color: p.muted },

    tool: { gap: space.sm },
    toolHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
    toolGlyph: { marginTop: 3 },
    toolName: { ...type.bodyBold, color: p.text },
    toolSubject: { ...type.body, color: p.muted, flex: 1 },
    toolFailed: { ...type.caption, fontFamily: fonts.bold, color: p.text, marginTop: 2 },
    toolOutput: { backgroundColor: p.surface, borderRadius: radius.sm, maxHeight: 320, marginLeft: 22 },
    toolOutputText: { ...mono, color: p.text, padding: space.md },

    changes: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: space.xs },
    changesText: { ...type.bodyMedium, color: p.text },
    diff: { gap: space.xs },
    diffFile: { ...type.caption, fontFamily: fonts.medium, color: p.text },
    patch: { backgroundColor: p.surface, borderRadius: radius.sm, maxHeight: 360 },
    patchText: { ...mono, color: p.muted, padding: space.md },
    added: { color: p.text, fontFamily: fonts.medium },
    removed: { color: p.muted, textDecorationLine: 'line-through' },
    hunk: { color: p.muted },
    meta: { ...type.caption, color: p.muted },

    working: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
    workingQuiet: { marginTop: 0 },
    workingText: { ...type.caption, color: p.muted },

    center: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xxl, gap: space.md },
    centerTitle: { ...type.title, color: p.text },
    centerText: { ...type.body, color: p.muted },
    centerActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },

    card: {
      marginHorizontal: space.md,
      marginBottom: space.sm,
      padding: space.lg,
      gap: space.sm,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: p.goldInk,
      backgroundColor: p.surface,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    cardTitle: { ...type.bodyBold, color: p.text, flex: 1 },
    cardScroll: { maxHeight: 160 },
    cardText: { ...type.body, color: p.text },
    choice: { paddingVertical: 10, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam, backgroundColor: p.bg },
    choiceSelected: { borderColor: p.goldInk },
    choiceLabel: { ...type.bodyMedium, color: p.text },
    answerRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
    answerInput: { flex: 1 },
    cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
    cardError: { ...type.caption, color: p.text, flex: 1 },
    promptError: { ...type.caption, color: p.muted, paddingHorizontal: space.xl, paddingBottom: space.xs },

    input: {
      ...type.body,
      color: p.text,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: p.seam,
      backgroundColor: p.surface,
    },
    solid: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: p.text },
    solidPressed: { opacity: 0.85 },
    solidLabel: { ...type.bodyBold, color: p.bg },
    quiet: { paddingVertical: 11, paddingHorizontal: space.lg, borderRadius: radius.sm, borderWidth: 1.5, borderColor: p.seam },
    quietLabel: { ...type.bodyBold, color: p.text },
  });
}
