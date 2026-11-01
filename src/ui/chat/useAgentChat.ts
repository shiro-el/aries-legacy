import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NativeAgentChatBinding,
  NativeAgentInteractionPrompt,
} from 'react-native-whip-ssh';
import type { ChatRowsSource } from 'react-native-whip-ssh/src/chatRows';

import { emptyTranscript, type AgentChatState } from '../../agentChat';
import { useAgentChatOpen } from '../../hooks/useAgentChatOpen';
import { useNativeChatRows } from '../../hooks/useNativeChatRows';
import { freeTextChoice } from '../../lib/menuAnswer';
import { resolveChatRow } from '../../lib/nativeChatRows';
import type { HerdrClient } from '../../services/HerdrClient';
import { agentTranscriptService } from '../../services/NativeTranscriptService';
import type { PaneInfo } from '../../types';

const LOADING: AgentChatState = { sessionId: '', transcript: emptyTranscript(''), status: 'loading' };

type Options = {
  hostSessionId: string;
  pane: PaneInfo | undefined;
  client: HerdrClient | undefined;
  onRefresh: () => Promise<void>;
};

/**
 * Binds one agent pane to its live transcript, the rows Rust lays out for
 * it, and the question the agent is waiting on, if any.
 */
export function useAgentChat({ hostSessionId, pane, client, onRefresh }: Options) {
  const terminalId = pane?.terminal_id ?? null;
  // Herdr learns the agent's session from its integration hook. Codex only
  // creates one when the first message is sent, so a fresh pane has none.
  const agentSessionId = pane?.agent_session?.value.trim() || null;
  const [binding, setBinding] = useState<NativeAgentChatBinding | null>(null);
  const [state, setState] = useState<AgentChatState>(LOADING);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const opener = useAgentChatOpen({
    hostSessionId,
    terminalId,
    pane,
    visible: true,
    client: client ?? null,
    onBound: projection => {
      setBinding(projection.binding);
      setState(projection.state);
    },
    onRefresh,
  });
  const openRef = useRef(opener.open);
  openRef.current = opener.open;

  // True when the transcript was already live in Rust before this screen
  // asked for it, so there is no restore to wait out.
  const [warm, setWarm] = useState(false);

  // Declared after useAgentChatOpen, so its cancel-on-change runs first.
  useEffect(() => {
    setBinding(null);
    setState(LOADING);
    setExpanded(new Set());
    setWarm(false);
    if (!client || !terminalId || !agentSessionId) return;
    // Reuse a binding Rust still holds instead of reopening it: reconcile only
    // reads the current projection and never restarts the transcript follower.
    let current: ReturnType<typeof agentTranscriptService.reconcile> | null = null;
    try {
      current = agentTranscriptService.reconcile(hostSessionId, terminalId, client.native);
    } catch {
      current = null;
    }
    if (current?.type === 'bound' && current.state.status !== 'error' && current.state.status !== 'unavailable') {
      setBinding(current.binding);
      setState(current.state);
      setWarm(current.state.status === 'live');
      return;
    }
    void openRef.current();
  }, [agentSessionId, client, hostSessionId, terminalId]);

  const token = binding?.bindingToken;
  useEffect(() => {
    if (!token) return;
    return agentTranscriptService.subscribe(token, next => {
      if (next) setState(next);
      else setBinding(null);
    });
  }, [token]);

  const source = useMemo<ChatRowsSource | undefined>(
    () => (binding && client ? { type: 'live', runtime: client.native, key: binding.transcriptKey } : undefined),
    [binding, client],
  );
  const lastTurn = state.transcript.turns.at(-1);
  const working = lastTurn?.status === 'working' || pane?.agent_status === 'working';
  const store = useNativeChatRows(source, state, working, expanded);
  const blocks = useMemo(
    () => store.rows.flatMap(row => {
      const block = resolveChatRow(row, state);
      return block ? [block] : [];
    }),
    // store.rows is replaced on every applied patch.
    [store.rows, state],
  );

  const settled = useSettled(
    token,
    warm,
    store.ready
      && state.status !== 'loading'
      && store.transcriptRevision >= (state.revision ?? 0),
    store.ready,
    store.rows,
  );

  const prompt = useInteractionPrompt(client, terminalId, token, pane);

  const toggle = useCallback((key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Each image path is its own paste, so the agent attaches the image it names.
  const answerMenu = prompt.answerInText;
  const send = useCallback(async (text: string, images: readonly string[] = []) => {
    if (!client || !pane) throw new Error('This pane is not connected.');
    const parts = [text, ...images];
    // A menu swallows pasted text, so a message has to go through its free-text row.
    if (await answerMenu(parts)) return;
    await client.native.submitPastes(pane.pane_id, parts);
  }, [answerMenu, client, pane]);

  return {
    binding,
    /** The pane runs an agent that has not started a conversation yet. */
    awaitingSession: pane !== undefined && agentSessionId === null,
    state,
    blocks,
    /** Rows have caught up with the restored transcript and stopped moving. */
    settled,
    rowsError: store.error,
    working,
    expanded,
    toggle,
    send,
    prompt,
    opening: opener.pendingTerminalId !== null,
    installing: opener.installing,
    notice: opener.notice,
    retry: () => { void opener.open(); },
    install: () => { void opener.install(); },
  };
}

const SETTLE_MS = 250;
const SETTLE_FALLBACK_MS = 4000;

/**
 * A restored conversation arrives in several row patches. Revealing the list
 * before they land shows it filling from the first message, so wait until the
 * rows match the transcript and hold still, then show the newest message once.
 */
function useSettled(token: string | undefined, warm: boolean, caughtUp: boolean, hasRows: boolean, rows: unknown): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(false), [token]);
  useEffect(() => {
    if (settled || !token || !caughtUp) return;
    // A warm transcript arrives as one row reset; nothing is left to land.
    const timer = setTimeout(() => setSettled(true), warm ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [caughtUp, rows, settled, token, warm]);
  useEffect(() => {
    if (settled || !token || !hasRows) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [hasRows, settled, token]);
  return settled;
}

/** Reads the live question while the pane is blocked, and answers it. */
function useInteractionPrompt(
  client: HerdrClient | undefined,
  terminalId: string | null,
  token: string | undefined,
  pane: PaneInfo | undefined,
) {
  const [prompt, setPrompt] = useState<NativeAgentInteractionPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = pane?.agent_status === 'blocked';
  const revision = pane?.revision;

  const read = useCallback(async () => {
    if (!client || !terminalId || !token) return null;
    const next = await client.native.agentInteractionPrompt(terminalId, token);
    setPrompt(next ?? null);
    return next ?? null;
  }, [client, terminalId, token]);

  useEffect(() => {
    setError(null);
    if (!blocked) {
      setPrompt(null);
      return;
    }
    let cancelled = false;
    read().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
    };
  }, [blocked, read, revision]);

  const respond = useCallback(async (action: string, answer = '') => {
    if (!client || !terminalId || !token || !prompt) return;
    setBusy(true);
    setError(null);
    try {
      if (action.startsWith('choice:')) {
        // Moving the cursor changes the prompt; confirm against the new one.
        await client.native.respondAgentInteraction(terminalId, token, prompt.token, action);
        const moved = await read();
        if (moved) await client.native.respondAgentInteraction(terminalId, token, moved.token, 'enter');
      } else {
        await client.native.respondAgentInteraction(terminalId, token, prompt.token, action, answer);
      }
      await read();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [client, prompt, read, terminalId, token]);

  /** False when no menu is waiting, so the message goes to the agent as usual. */
  const answerInText = useCallback(async (parts: readonly string[]): Promise<boolean> => {
    if (!client || !terminalId || !token || prompt?.kind !== 'menu') return false;
    const field = freeTextChoice(prompt);
    if (!field) throw new Error('choose one of the options above.');
    let current = prompt;
    if (!field.selected) {
      await client.native.respondAgentInteraction(terminalId, token, current.token, `choice:${field.index}`);
      // The row becomes a text field once selected; answer against that screen.
      current = (await read()) ?? current;
    }
    // Typed as one line: a pasted answer would cancel the question.
    const answer = parts.filter(Boolean).join(' ');
    await client.native.respondAgentInteraction(terminalId, token, current.token, 'answer', answer);
    await read();
    return true;
  }, [client, prompt, read, terminalId, token]);

  return { prompt, busy, error, respond, answerInText };
}
